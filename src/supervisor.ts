import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BridgeEnvelope } from "./runtime/bridge/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESTART_EXIT_CODE = 42;

type RuntimeRole = "gateway" | "worker";
type RestartTarget = "all" | "gateway" | "worker";

interface RestartState {
  requested?: boolean;
  requestedAt?: number;
  reason?: string;
  message?: string;
  target?: RestartTarget;
  metadata?: Record<string, unknown>;
}

interface SupervisorConfig {
  stateDir: string;
  command: string;
  args?: string[];
  gatewayArgs: string[];
  workerArgs: string[];
  cwd: string;
  restartDelayMs: number;
  maxRestarts: number;
  restartWindowMs: number;
  workerHeartbeatPath: string;
  workerHeartbeatMaxAgeMs: number;
  heartbeatCheckIntervalMs: number;
}

function defaultStateDirFromCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (path.basename(resolved) === ".ant") {
    return resolved;
  }
  return path.join(resolved, ".ant");
}

export function getDefaultConfig(): SupervisorConfig {
  const cwd = process.cwd();
  const stateDir = defaultStateDirFromCwd(cwd);
  return {
    stateDir,
    command: process.execPath,
    gatewayArgs: [path.join(__dirname, "cli.js"), "gateway"],
    workerArgs: [path.join(__dirname, "cli.js"), "worker"],
    cwd,
    restartDelayMs: 1000,
    maxRestarts: 10,
    restartWindowMs: 60_000,
    workerHeartbeatPath: path.join(stateDir, "heartbeat.worker"),
    workerHeartbeatMaxAgeMs: 20_000,
    heartbeatCheckIntervalMs: 5000,
  };
}

export class Supervisor {
  private readonly config: SupervisorConfig;
  private readonly legacyArgs?: string[];
  private gateway: ChildProcess | null = null;
  private worker: ChildProcess | null = null;
  private legacyChild: ChildProcess | null = null;
  private shuttingDown = false;
  private doneResolve: (() => void) | null = null;
  private restartCount = 0;
  private restartWindowStart = Date.now();
  private restartFileTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private restartQueue: Promise<void> = Promise.resolve();
  private readonly restartFile: string;
  private readonly supervisorPidFile: string;
  private readonly primaryPidFile: string;
  private workerSpawnedAt = 0;
  private restartStateBusy = false;
  private watcher: FSWatcher | null = null;

  private readonly sigintHandler = () => void this.shutdown("SIGINT");
  private readonly sigtermHandler = () => void this.shutdown("SIGTERM");
  private readonly sighupHandler = () => {
    void this.enqueueRestart(async () => {
      await this.restartAll("SIGHUP");
    });
  };

  constructor(config: Partial<SupervisorConfig> = {}) {
    this.config = { ...getDefaultConfig(), ...config };
    this.legacyArgs = Array.isArray((config as { args?: string[] }).args)
      ? (config as { args?: string[] }).args
      : undefined;
    this.restartFile = path.join(this.config.stateDir, "restart.json");
    this.supervisorPidFile = path.join(this.config.stateDir, "ant.supervisor.pid");
    this.primaryPidFile = path.join(this.config.stateDir, "ant.pid");
  }

  async start(): Promise<void> {
    if (this.legacyArgs) {
      await this.startLegacy();
      return;
    }

    await fs.mkdir(this.config.stateDir, { recursive: true });
    await this.writePidFiles();
    this.registerSignals();

    await this.spawnRole("gateway");
    await this.spawnRole("worker");

    this.startMonitors();

    await new Promise<void>((resolve) => {
      this.doneResolve = resolve;
    });
  }

  private async startLegacy(): Promise<void> {
    await fs.mkdir(this.config.stateDir, { recursive: true });
    this.registerSignals();
    this.startLegacyWatcher();

    while (!this.shuttingDown) {
      if (!this.allowRestart("legacy")) {
        console.error("[supervisor] Too many restarts within time window, exiting");
        process.exit(1);
      }

      this.legacyChild = spawn(this.config.command, this.legacyArgs ?? [], {
        cwd: this.config.cwd,
        env: {
          ...process.env,
          ANT_SUPERVISED: "1",
        },
        stdio: "inherit",
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        if (!this.legacyChild) {
          resolve(null);
          return;
        }
        this.legacyChild.on("exit", (code) => {
          resolve(code);
        });
        this.legacyChild.on("error", () => {
          resolve(1);
        });
      });

      this.legacyChild = null;
      if (this.shuttingDown) break;

      const state = await this.consumeRestartState();
      const shouldRestart = exitCode === RESTART_EXIT_CODE || Boolean(state?.requested);
      if (!shouldRestart && exitCode === 0) break;
      if (!shouldRestart && exitCode !== 0) {
        process.exit(exitCode ?? 1);
      }

      await this.sleep(this.config.restartDelayMs);
    }

    this.stopLegacyWatcher();
    this.unregisterSignals();
  }

  private startLegacyWatcher(): void {
    try {
      this.watcher = watch(this.config.stateDir, () => undefined);
    } catch {
      this.watcher = null;
    }
  }

  private stopLegacyWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  private registerSignals(): void {
    process.on("SIGINT", this.sigintHandler);
    process.on("SIGTERM", this.sigtermHandler);
    process.on("SIGHUP", this.sighupHandler);
  }

  private unregisterSignals(): void {
    process.off("SIGINT", this.sigintHandler);
    process.off("SIGTERM", this.sigtermHandler);
    process.off("SIGHUP", this.sighupHandler);
  }

  private startMonitors(): void {
    this.restartFileTimer = setInterval(() => {
      void this.checkRestartState();
    }, 1000);
    this.restartFileTimer.unref();

    this.heartbeatTimer = setInterval(() => {
      void this.checkWorkerHeartbeat();
    }, Math.max(1000, this.config.heartbeatCheckIntervalMs));
    this.heartbeatTimer.unref();
  }

  private stopMonitors(): void {
    if (this.restartFileTimer) {
      clearInterval(this.restartFileTimer);
      this.restartFileTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async writePidFiles(): Promise<void> {
    await fs.writeFile(this.supervisorPidFile, String(process.pid), "utf-8");
    await fs.writeFile(this.primaryPidFile, String(process.pid), "utf-8");
  }

  private async removePidFiles(): Promise<void> {
    await fs.unlink(this.supervisorPidFile).catch(() => undefined);
    await fs.unlink(this.primaryPidFile).catch(() => undefined);
  }

  private childForRole(role: RuntimeRole): ChildProcess | null {
    return role === "gateway" ? this.gateway : this.worker;
  }

  private setChild(role: RuntimeRole, child: ChildProcess | null): void {
    if (role === "gateway") {
      this.gateway = child;
    } else {
      this.worker = child;
    }
  }

  private argsForRole(role: RuntimeRole): string[] {
    return role === "gateway" ? this.config.gatewayArgs : this.config.workerArgs;
  }

  private async spawnRole(role: RuntimeRole): Promise<void> {
    if (this.shuttingDown) return;

    const args = this.argsForRole(role);
    const child = spawn(this.config.command, args, {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        ANT_SUPERVISED: "1",
        ANT_RUNTIME_ROLE: role,
      },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    this.setChild(role, child);
    if (role === "worker") {
      this.workerSpawnedAt = Date.now();
    }

    child.on("message", (message: unknown) => {
      this.handleBridgeMessage(role, message);
    });

    child.on("exit", (code, signal) => {
      this.handleChildExit(role, code, signal);
    });

    child.on("error", () => {
      this.handleChildExit(role, 1, null);
    });
  }

  private handleBridgeMessage(source: RuntimeRole, message: unknown): void {
    if (!message || typeof message !== "object") return;
    const envelope = message as Partial<BridgeEnvelope>;
    if (envelope.channel !== "bridge") return;
    const targetRole = envelope.target === "gateway" || envelope.target === "worker" ? envelope.target : null;
    if (!targetRole) return;

    const target = this.childForRole(targetRole);
    if (!target || typeof target.send !== "function" || target.exitCode !== null) return;
    target.send(message as BridgeEnvelope);
  }

  private handleChildExit(role: RuntimeRole, code: number | null, signal: NodeJS.Signals | null): void {
    this.setChild(role, null);
    if (this.shuttingDown) return;

    void this.enqueueRestart(async () => {
      if (this.shuttingDown) return;

      const state = await this.consumeRestartState();
      if (state) {
        await this.restartFromState(state, `restart_file:${role}`);
        return;
      }

      if (code === RESTART_EXIT_CODE) {
        await this.restartAll(`exit_code_42:${role}`);
        return;
      }

      if (role === "worker") {
        await this.restartWorker(`worker_exit:${String(code ?? signal ?? "unknown")}`);
      } else {
        await this.restartGateway(`gateway_exit:${String(code ?? signal ?? "unknown")}`);
      }
    });
  }

  private async stopRole(role: RuntimeRole): Promise<void> {
    const child = this.childForRole(role);
    if (!child) return;
    if (child.exitCode !== null) {
      this.setChild(role, null);
      return;
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      const timer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
        finish();
      }, 10_000);
      timer.unref();

      child.once("exit", () => {
        clearTimeout(timer);
        finish();
      });

      child.kill("SIGTERM");
    });

    this.setChild(role, null);
  }

  private async restartGateway(reason: string): Promise<void> {
    if (!this.allowRestart(reason)) {
      await this.shutdown("restart_limit", 1);
      return;
    }

    await this.stopRole("gateway");
    await this.sleep(this.config.restartDelayMs);
    await this.spawnRole("gateway");
  }

  private async restartWorker(reason: string): Promise<void> {
    if (!this.allowRestart(reason)) {
      await this.shutdown("restart_limit", 1);
      return;
    }

    await this.stopRole("worker");
    await this.sleep(this.config.restartDelayMs);
    await this.spawnRole("worker");
  }

  private async restartAll(reason: string): Promise<void> {
    if (!this.allowRestart(reason)) {
      await this.shutdown("restart_limit", 1);
      return;
    }

    await this.stopRole("gateway");
    await this.stopRole("worker");
    await this.sleep(this.config.restartDelayMs);
    await this.spawnRole("gateway");
    await this.spawnRole("worker");
  }

  private allowRestart(_reason: string): boolean {
    const now = Date.now();
    if (now - this.restartWindowStart > this.config.restartWindowMs) {
      this.restartWindowStart = now;
      this.restartCount = 0;
    }
    if (this.restartCount >= this.config.maxRestarts) return false;
    this.restartCount += 1;
    return true;
  }

  private async checkRestartState(): Promise<void> {
    if (this.shuttingDown || this.restartStateBusy) return;
    this.restartStateBusy = true;
    try {
      const state = await this.consumeRestartState();
      if (!state) return;
      await this.enqueueRestart(async () => {
        await this.restartFromState(state, "restart_file_poll");
      });
    } finally {
      this.restartStateBusy = false;
    }
  }

  private async consumeRestartState(): Promise<RestartState | null> {
    try {
      const raw = await fs.readFile(this.restartFile, "utf-8");
      const parsed = JSON.parse(raw) as RestartState;
      if (!parsed?.requested) return null;
      await fs.unlink(this.restartFile).catch(() => undefined);
      return parsed;
    } catch {
      return null;
    }
  }

  private async restartFromState(state: RestartState, source: string): Promise<void> {
    const target: RestartTarget = state.target ?? "all";
    const reason = state.reason ? `${source}:${state.reason}` : source;
    if (target === "worker") {
      await this.restartWorker(reason);
      return;
    }
    if (target === "gateway") {
      await this.restartGateway(reason);
      return;
    }
    await this.restartAll(reason);
  }

  private async checkWorkerHeartbeat(): Promise<void> {
    if (this.shuttingDown) return;
    if (!this.worker || this.worker.exitCode !== null) return;

    const now = Date.now();
    // Grace period: allow worker startup/init before requiring heartbeat file.
    if (this.workerSpawnedAt > 0 && now - this.workerSpawnedAt < this.config.workerHeartbeatMaxAgeMs) {
      return;
    }

    try {
      const stat = await fs.stat(this.config.workerHeartbeatPath);
      const ageMs = now - stat.mtimeMs;
      if (ageMs <= this.config.workerHeartbeatMaxAgeMs) return;
    } catch {
      // Missing heartbeat file counts as unhealthy.
    }

    await this.enqueueRestart(async () => {
      if (this.shuttingDown) return;
      await this.restartWorker("worker_heartbeat_stale");
    });
  }

  private enqueueRestart(task: () => Promise<void>): Promise<void> {
    this.restartQueue = this.restartQueue
      .then(task)
      .catch(async () => {
        await this.shutdown("restart_error", 1);
      });
    return this.restartQueue;
  }

  private async shutdown(reason: string, exitCode = 0): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.stopMonitors();
    this.stopLegacyWatcher();
    this.unregisterSignals();

    if (this.legacyChild && this.legacyChild.exitCode === null) {
      this.legacyChild.kill("SIGTERM");
    }
    await this.stopRole("gateway");
    await this.stopRole("worker");
    await this.removePidFiles();

    this.doneResolve?.();
    this.doneResolve = null;
    process.exitCode = exitCode;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

export function parseArgs(argv: string[] = process.argv.slice(2)): { config: Partial<SupervisorConfig>; help: boolean } {
  const config: Partial<SupervisorConfig> = {};
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--state-dir" && argv[i + 1]) {
      config.stateDir = argv[++i]!;
    } else if (arg === "--restart-delay" && argv[i + 1]) {
      config.restartDelayMs = parseInt(argv[++i]!, 10);
    } else if (arg === "--max-restarts" && argv[i + 1]) {
      config.maxRestarts = parseInt(argv[++i]!, 10);
    }
  }

  return { config, help };
}

export function printHelp(): void {
  console.log(`
ANT Supervisor

Usage: node supervisor.js [options]

Options:
  --help, -h          Show help
  --state-dir PATH    Runtime state directory
  --restart-delay MS  Delay before restart
  --max-restarts N    Restart limit in window
`);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

export async function runSupervisorCli(argv: string[] = process.argv): Promise<void> {
  const { config, help } = parseArgs(argv.slice(2));
  if (help) {
    printHelp();
    return;
  }
  const supervisor = new Supervisor(config);
  await supervisor.start();
}

if (isMainModule()) {
  runSupervisorCli().catch((err) => {
    console.error("[supervisor] fatal", err);
    process.exitCode = 1;
  });
}

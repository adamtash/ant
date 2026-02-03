import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

type WatchdogConfig = {
  mode: "child" | "docker";
  healthUrl: string;
  heartbeatPath: string;
  heartbeatMaxAgeMs: number;
  healthTimeoutMs: number;
  healthCheckIntervalMs: number;
  maxConsecutiveFailures: number;
  restartCooldownMs: number;
  containerName?: string;
  startCommand: string;
  startCwd: string;
};

function readEnvInt(name: string, fallback: number): number {
  const raw = (process.env[name] || "").trim();
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCommand(command: string): { cmd: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) tokens.push(current);
  const [cmd, ...args] = tokens;
  if (!cmd) throw new Error("MAIN_ANT_START_COMMAND is empty");
  return { cmd, args };
}

async function checkHttpOk(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(Math.max(100, timeoutMs)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function checkHeartbeat(filePath: string, maxAgeMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function loadConfig(): WatchdogConfig {
  const cwd = process.cwd();
  const healthUrl = (process.env.MAIN_ANT_HEALTH_URL || "http://127.0.0.1:5117/api/health").trim();
  const heartbeatPath = path.resolve(
    process.env.MAIN_ANT_HEARTBEAT_PATH?.trim() || path.join(cwd, ".ant", "heartbeat")
  );
  const containerName = process.env.MAIN_ANT_CONTAINER?.trim() || undefined;
  const startCommand = (process.env.MAIN_ANT_START_COMMAND || "node dist/cli.js start -c ant.config.json").trim();
  const startCwd = path.resolve(process.env.MAIN_ANT_START_CWD?.trim() || cwd);

  return {
    mode: containerName ? "docker" : "child",
    healthUrl,
    heartbeatPath,
    heartbeatMaxAgeMs: readEnvInt("HEARTBEAT_MAX_AGE_MS", 20_000),
    healthTimeoutMs: readEnvInt("HEALTH_TIMEOUT_MS", 5000),
    healthCheckIntervalMs: readEnvInt("HEALTH_CHECK_INTERVAL_MS", 10_000),
    maxConsecutiveFailures: readEnvInt("MAX_CONSECUTIVE_FAILURES", 3),
    restartCooldownMs: readEnvInt("RESTART_COOLDOWN_MS", 30_000),
    containerName,
    startCommand,
    startCwd,
  };
}

class Watchdog {
  private readonly cfg: WatchdogConfig;
  private child: ChildProcess | null = null;
  private consecutiveFailures = 0;
  private lastRestartAt = 0;
  private stopping = false;

  constructor(cfg: WatchdogConfig) {
    this.cfg = cfg;
  }

  start(): void {
    process.on("SIGINT", () => void this.shutdown("SIGINT"));
    process.on("SIGTERM", () => void this.shutdown("SIGTERM"));
    if (this.cfg.mode === "child") {
      this.ensureChildRunning();
    }
    void this.loop();
  }

  private ensureChildRunning(): void {
    if (this.cfg.mode !== "child") return;
    if (this.child && this.child.exitCode === null) return;

    const { cmd, args } = parseCommand(this.cfg.startCommand);
    this.child = spawn(cmd, args, {
      cwd: this.cfg.startCwd,
      env: {
        ...process.env,
        ANT_SUPERVISED: "1",
      },
      stdio: "inherit",
    });

    this.child.on("exit", (code, signal) => {
      console.log(`[watchdog] main exited (code=${code ?? "null"}, signal=${signal ?? "none"})`);
      this.child = null;
    });

    console.log(`[watchdog] started main (pid=${this.child.pid ?? "unknown"})`);
  }

  private async stopChild(): Promise<void> {
    if (this.cfg.mode !== "child") return;
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null) {
      this.child = null;
      return;
    }

    child.kill("SIGTERM");
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      await sleep(200);
    }

    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await sleep(250);
    }

    this.child = null;
  }

  private async restartContainer(containerName: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn("docker", ["restart", containerName], { stdio: "inherit" });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) resolve();
        reject(new Error(`docker restart exited with code ${code ?? "null"}`));
      });
    });
  }

  private async restart(reason: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastRestartAt < this.cfg.restartCooldownMs) {
      console.log("[watchdog] restart suppressed (cooldown)");
      return;
    }

    this.lastRestartAt = now;
    this.consecutiveFailures = 0;
    console.log(`[watchdog] restarting main (${reason})`);
    if (this.cfg.mode === "docker" && this.cfg.containerName) {
      await this.restartContainer(this.cfg.containerName);
      return;
    }
    await this.stopChild();
    this.ensureChildRunning();
  }

  private async checkOnce(): Promise<void> {
    const healthOk = await checkHttpOk(this.cfg.healthUrl, this.cfg.healthTimeoutMs);
    const heartbeatOk = await checkHeartbeat(this.cfg.heartbeatPath, this.cfg.heartbeatMaxAgeMs);

    if (healthOk && heartbeatOk) {
      this.consecutiveFailures = 0;
      return;
    }

    this.consecutiveFailures += 1;
    console.log(
      `[watchdog] unhealthy (health=${healthOk ? "ok" : "fail"}, heartbeat=${heartbeatOk ? "ok" : "stale"}) ` +
        `failures=${this.consecutiveFailures}/${this.cfg.maxConsecutiveFailures}`
    );

    if (this.consecutiveFailures >= this.cfg.maxConsecutiveFailures) {
      await this.restart("health_check_failed");
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      this.ensureChildRunning();
      await this.checkOnce();
      await sleep(this.cfg.healthCheckIntervalMs);
    }
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    console.log(`[watchdog] shutting down (${signal})`);
    await this.stopChild();
    process.exitCode = 0;
  }
}

const cfg = loadConfig();
console.log("[watchdog] starting", {
  mode: cfg.mode,
  healthUrl: cfg.healthUrl,
  heartbeatPath: cfg.heartbeatPath,
  intervalMs: cfg.healthCheckIntervalMs,
  maxFailures: cfg.maxConsecutiveFailures,
});

new Watchdog(cfg).start();

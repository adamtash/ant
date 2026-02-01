/**
 * Supervisor - Process supervisor for graceful restart and task resumption
 *
 * Features:
 * - Spawns the main ANT process as a child process
 * - Watches for the restart flag file at .ant/restart.json
 * - Handles restart requests (exit code 42 or restart.json exists)
 * - Gracefully handles SIGINT/SIGTERM
 * - Passes through command line arguments to the child process
 *
 * This enables graceful restarts when the agent updates its own code.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Exit code used by restart-manager to signal restart request
 */
const RESTART_EXIT_CODE = 42;

/**
 * Restart state stored in .ant/restart.json (compatible with restart-manager.ts)
 */
interface RestartState {
  requested: boolean;
  requestedAt: number;
  reason: string;
  message?: string;
  taskContext?: {
    id: string;
    type: string;
    query?: string;
    sessionKey?: string;
    chatId?: string;
    channel?: string;
    startedAt: number;
    state: Record<string, unknown>;
    toolsExecuted: string[];
    partialResponse?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Supervisor configuration
 */
interface SupervisorConfig {
  stateDir: string;
  command: string;
  args: string[];
  cwd: string;
  restartDelayMs: number;
  maxRestarts: number;
  restartWindowMs: number;
}

/**
 * Get default configuration based on command line arguments
 */
function getDefaultConfig(): SupervisorConfig {
  // Pass through all arguments after 'supervisor' command to the child
  const cliArgs = process.argv.slice(2);

  // Remove 'supervisor' if it's the first arg (when invoked as `ant supervisor run`)
  const childArgs = cliArgs[0] === "supervisor" ? cliArgs.slice(1) : cliArgs;

  // If no command specified, default to 'run'
  if (childArgs.length === 0) {
    childArgs.push("run");
  }

  return {
    stateDir: path.join(process.cwd(), ".ant"),
    command: process.execPath, // Use same node executable
    args: [path.join(__dirname, "cli.js"), ...childArgs],
    cwd: process.cwd(),
    restartDelayMs: 1000,
    maxRestarts: 10,
    restartWindowMs: 60000,
  };
}

/**
 * Main supervisor class
 */
class Supervisor {
  private config: SupervisorConfig;
  private child: ChildProcess | null = null;
  private restartCount = 0;
  private lastRestartTime = 0;
  private shuttingDown = false;
  private watcher: FSWatcher | null = null;
  private restartFile: string;

  constructor(config: Partial<SupervisorConfig> = {}) {
    const defaults = getDefaultConfig();
    this.config = { ...defaults, ...config };
    this.restartFile = path.join(this.config.stateDir, "restart.json");
  }

  /**
   * Start the supervisor
   */
  async start(): Promise<void> {
    console.log("[supervisor] Starting ANT supervisor...");
    console.log(`[supervisor] State directory: ${this.config.stateDir}`);
    console.log(`[supervisor] Child command: ${this.config.command} ${this.config.args.join(" ")}`);

    // Ensure state directory exists
    await fs.mkdir(this.config.stateDir, { recursive: true });

    // Set up signal handlers
    process.on("SIGINT", () => this.shutdown("SIGINT"));
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));

    // Start watching for restart file
    this.startWatching();

    // Start the main loop
    await this.runLoop();
  }

  /**
   * Start watching the restart file for changes
   */
  private startWatching(): void {
    try {
      // Watch the state directory for changes to restart.json
      this.watcher = watch(this.config.stateDir, (eventType, filename) => {
        if (filename === "restart.json" && eventType === "change") {
          // File was modified - the child process will handle it
          // We just log for visibility
          console.log("[supervisor] Detected restart.json change");
        }
      });

      this.watcher.on("error", (err) => {
        console.error(`[supervisor] Watch error: ${err.message}`);
      });
    } catch {
      // Directory might not exist yet, that's ok
      console.log("[supervisor] Could not watch state directory (will be created on first run)");
    }
  }

  /**
   * Stop watching
   */
  private stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Main run loop - keeps process running
   */
  private async runLoop(): Promise<void> {
    while (!this.shuttingDown) {
      // Check restart limits
      if (!this.canRestart()) {
        console.error("[supervisor] Too many restarts within time window, exiting");
        console.error(`[supervisor] (${this.restartCount} restarts in ${this.config.restartWindowMs}ms)`);
        process.exit(1);
      }

      // Spawn the child process
      await this.spawnChild();

      // Wait for child to exit
      const exitCode = await this.waitForExit();

      if (this.shuttingDown) break;

      // Check if this was a restart request
      const isRestartCode = exitCode === RESTART_EXIT_CODE;
      const restartState = await this.checkRestartState();
      const shouldRestart = isRestartCode || restartState?.requested;

      if (exitCode === 0 && !shouldRestart) {
        // Clean exit, no restart needed
        console.log("[supervisor] Process exited cleanly (code 0)");
        break;
      }

      if (shouldRestart) {
        const reason = restartState?.reason || (isRestartCode ? "exit_code_42" : "unknown");
        console.log(`[supervisor] Restart requested (reason: ${reason})`);

        if (restartState?.message) {
          console.log(`[supervisor] Message: ${restartState.message}`);
        }

        if (restartState?.taskContext) {
          console.log(`[supervisor] Will resume task: ${restartState.taskContext.id}`);
        }

        // Don't clear restart state - the child process will read and clear it on startup
      } else {
        // Non-zero exit without restart request - might be a crash
        console.log(`[supervisor] Process exited with code ${exitCode}`);

        // Only restart on crash if it wasn't a normal termination signal
        if (exitCode === null || exitCode > 128) {
          console.log("[supervisor] Process was killed, restarting...");
        } else if (exitCode !== 0) {
          console.log("[supervisor] Non-zero exit without restart request, exiting supervisor");
          process.exit(exitCode);
        }
      }

      // Wait before restarting
      console.log(`[supervisor] Waiting ${this.config.restartDelayMs}ms before restart...`);
      await this.sleep(this.config.restartDelayMs);

      this.restartCount++;
      this.lastRestartTime = Date.now();
      console.log("[supervisor] Restarting child process...");
    }

    this.stopWatching();
    console.log("[supervisor] Supervisor exiting");
  }

  /**
   * Spawn the child process
   */
  private async spawnChild(): Promise<void> {
    console.log(`[supervisor] Spawning: ${this.config.command} ${this.config.args.join(" ")}`);

    this.child = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: {
        ...process.env,
        // Tell child it's running under supervisor
        ANT_SUPERVISED: "1",
      },
      stdio: "inherit",
    });

    this.child.on("spawn", () => {
      console.log(`[supervisor] Child process started (pid: ${this.child?.pid})`);
    });
  }

  /**
   * Wait for child process to exit
   */
  private waitForExit(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.child) {
        resolve(null);
        return;
      }

      this.child.on("exit", (code, signal) => {
        if (signal) {
          console.log(`[supervisor] Child process killed by signal: ${signal}`);
        }
        this.child = null;
        resolve(code);
      });

      this.child.on("error", (err) => {
        console.error(`[supervisor] Process error: ${err.message}`);
        this.child = null;
        resolve(1);
      });
    });
  }

  /**
   * Check if we can restart (rate limiting)
   */
  private canRestart(): boolean {
    const now = Date.now();

    // Reset counter if outside window
    if (now - this.lastRestartTime > this.config.restartWindowMs) {
      this.restartCount = 0;
    }

    return this.restartCount < this.config.maxRestarts;
  }

  /**
   * Check for scheduled restart state
   */
  private async checkRestartState(): Promise<RestartState | null> {
    try {
      const content = await fs.readFile(this.restartFile, "utf-8");
      return JSON.parse(content) as RestartState;
    } catch {
      return null;
    }
  }

  /**
   * Graceful shutdown
   */
  private shutdown(signal: string): void {
    if (this.shuttingDown) {
      console.log(`[supervisor] Already shutting down, received ${signal} again`);
      if (this.child) {
        console.log("[supervisor] Force killing child process");
        this.child.kill("SIGKILL");
      }
      process.exit(1);
    }

    console.log(`[supervisor] Received ${signal}, shutting down gracefully...`);
    this.shuttingDown = true;

    if (this.child) {
      // Forward the signal to child
      this.child.kill(signal as NodeJS.Signals);

      // Force kill after 10 seconds
      const forceKillTimer = setTimeout(() => {
        if (this.child) {
          console.log("[supervisor] Force killing child process after timeout");
          this.child.kill("SIGKILL");
        }
      }, 10000);

      // Don't let the timer keep the process alive
      forceKillTimer.unref();
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Parse command line arguments for supervisor-specific options
 */
function parseArgs(): { config: Partial<SupervisorConfig>; help: boolean } {
  const args = process.argv.slice(2);
  const config: Partial<SupervisorConfig> = {};
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--restart-delay" && args[i + 1]) {
      config.restartDelayMs = parseInt(args[++i], 10);
    } else if (arg === "--max-restarts" && args[i + 1]) {
      config.maxRestarts = parseInt(args[++i], 10);
    } else if (arg === "--state-dir" && args[i + 1]) {
      config.stateDir = args[++i];
    }
  }

  return { config, help };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
ANT Supervisor - Process supervisor for graceful restarts

Usage: node supervisor.js [options] [-- child-args...]

Options:
  --help, -h          Show this help message
  --restart-delay MS  Delay before restarting (default: 1000)
  --max-restarts N    Max restarts in window (default: 10)
  --state-dir PATH    State directory (default: .ant)

The supervisor:
  1. Spawns the main ANT process as a child
  2. Watches for restart requests via:
     - Exit code 42 from the child process
     - .ant/restart.json file with { requested: true }
  3. Gracefully restarts when requested
  4. Forwards SIGINT/SIGTERM to the child
  5. Passes remaining arguments to the child process

Examples:
  node supervisor.js run              # Run ANT with supervisor
  node supervisor.js run --tui        # Run ANT with TUI mode
  node supervisor.js --max-restarts 5 run
`);
}

// Run supervisor if this is the main module
const { config, help } = parseArgs();

if (help) {
  printHelp();
  process.exit(0);
}

const supervisor = new Supervisor(config);
supervisor.start().catch((err) => {
  console.error("[supervisor] Fatal error:", err);
  process.exit(1);
});

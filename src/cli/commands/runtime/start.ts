/**
 * Runtime Start Command - Start the agent runtime
 */

import { spawn } from "node:child_process";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, writePidFile, ensureRuntimePaths } from "../../../gateway/process-control.js";

export interface StartOptions {
  config?: string;
  tui?: boolean;
  detached?: boolean;
  quiet?: boolean;
}

/**
 * Start the agent runtime
 */
export async function start(cfg: AntConfig, options: StartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  // Ensure directories exist
  await ensureRuntimePaths(cfg);

  // Check if already running
  const existingPid = await readPidFile(cfg);
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      throw new RuntimeError(`Agent is already running (PID: ${existingPid})`, "Use 'ant stop' to stop it first, or 'ant restart' to restart.");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") {
        throw err;
      }
      // Process doesn't exist, stale PID file
    }
  }

  out.info("Starting agent runtime...");

  if (options.detached) {
    // Start in background
    const args = ["start"];
    if (options.tui) args.push("--tui");

    const child = spawn(process.execPath, [process.argv[1], ...args], {
      detached: true,
      stdio: "ignore",
      cwd: cfg.resolved.workspaceDir,
      env: {
        ...process.env,
        ANT_CONFIG: cfg.resolved.configPath,
      },
    });

    child.unref();
    out.success(`Agent started in background (PID: ${child.pid})`);

    if (cfg.ui.enabled) {
      const url = cfg.ui.openUrl || `http://${cfg.ui.host}:${cfg.ui.port}`;
      out.info(`Web UI will be available at: ${url}`);
    }
  } else {
    // Start in foreground
    out.info("Starting in foreground mode...");

    // Write PID file
    await writePidFile(cfg);

    // Start the gateway server
    const { GatewayServer } = await import("../../../gateway/server.js");
    const { createLogger } = await import("../../../log.js");

    const logLevel = cfg.logging?.level || "info";
    const logger = createLogger(logLevel);

    const server = new GatewayServer({
      config: {
        port: cfg.ui.port,
        host: cfg.ui.host,
        stateDir: cfg.resolved.stateDir,
      },
      logger,
    });

    await server.start();

    out.success("Agent runtime started");
    if (cfg.ui.enabled) {
      const url = cfg.ui.openUrl || `http://${cfg.ui.host}:${cfg.ui.port}`;
      out.info(`Web UI available at: ${url}`);
    }

    // Keep running until interrupted
    await new Promise<void>((resolve) => {
      process.on("SIGINT", () => {
        out.info("\nShutting down...");
        server.stop().then(() => resolve());
      });
      process.on("SIGTERM", () => {
        out.info("\nShutting down...");
        server.stop().then(() => resolve());
      });
    });
  }
}

export default start;

/**
 * Monitoring Dashboard Command - Show TUI dashboard
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { readPidFile } from "../../../gateway/process-control.js";

export interface DashboardOptions {
  config?: string;
  quiet?: boolean;
}

/**
 * Show TUI dashboard
 *
 * This launches the runtime with TUI mode if not already running,
 * or connects to the running instance to show status.
 */
export async function dashboard(cfg: AntConfig, options: DashboardOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  // Check if runtime is running
  const pid = await readPidFile(cfg);

  if (pid) {
    // Runtime is running - try to connect to web UI for status
    if (cfg.ui.enabled) {
      const url = cfg.ui.openUrl || `http://${cfg.ui.host}:${cfg.ui.port}`;
      out.info(`Agent is running. Opening dashboard at ${url}`);

      // Try to open in browser
      const { exec } = await import("node:child_process");
      const platform = process.platform;
      const openCmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";

      exec(`${openCmd} ${url}`, (err) => {
        if (err) {
          out.warn(`Could not open browser. Visit ${url} manually.`);
        }
      });

      // Also show inline status
      await showInlineStatus(cfg, out);
    } else {
      out.info("Agent is running but web UI is disabled.");
      out.info("Enable ui.enabled in your config for the dashboard.");
    }
    return;
  }

  // Runtime not running - start with TUI
  out.info("Starting agent with TUI dashboard...");

  // Import and use the start command
  const { start } = await import("../runtime/start.js");
  await start(cfg, { tui: true });
}

/**
 * Show inline status from runtime
 */
async function showInlineStatus(cfg: AntConfig, out: OutputFormatter): Promise<void> {
  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);

    const res = await fetch(`${base}/api/status`, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (!res.ok) return;

    const data = (await res.json()) as {
      uptime?: number;
      activeTasks?: number;
      queuedTasks?: number;
      activeSubagents?: number;
    };

    out.newline();
    out.section("Current Status");
    if (data.uptime) out.keyValue("Uptime", out.formatDuration(data.uptime));
    if (data.activeTasks !== undefined) out.keyValue("Active Tasks", data.activeTasks);
    if (data.queuedTasks !== undefined) out.keyValue("Queued Tasks", data.queuedTasks);
    if (data.activeSubagents !== undefined) out.keyValue("Subagents", data.activeSubagents);
  } catch {
    // Ignore connection errors
  }
}

export default dashboard;

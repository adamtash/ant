/**
 * Runtime Status Command - Show runtime status
 */

import fs from "node:fs/promises";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { readPidFile, ensureRuntimePaths } from "../../../gateway/process-control.js";

export interface StatusOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

interface StatusInfo {
  running: boolean;
  pid: number | null;
  workspace: string;
  stateDir: string;
  config: string;
  ui: {
    enabled: boolean;
    url: string | null;
  };
  memory: {
    enabled: boolean;
    dbPath: string;
    dbExists: boolean;
  };
  uptime?: number;
}

/**
 * Show runtime status
 */
export async function status(cfg: AntConfig, options: StatusOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  const paths = await ensureRuntimePaths(cfg);

  // Check if running
  const pid = await readPidFile(cfg);
  let running = false;

  if (pid) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      // Process not running
    }
  }

  // Check memory database
  let memoryDbExists = false;
  try {
    await fs.access(cfg.resolved.memorySqlitePath);
    memoryDbExists = true;
  } catch {
    // DB doesn't exist
  }

  const statusInfo: StatusInfo = {
    running,
    pid: running ? pid : null,
    workspace: cfg.resolved.workspaceDir,
    stateDir: paths.stateDir,
    config: cfg.resolved.configPath,
    ui: {
      enabled: cfg.ui.enabled,
      url: cfg.ui.enabled ? cfg.ui.openUrl || `http://${cfg.ui.host}:${cfg.ui.port}` : null,
    },
    memory: {
      enabled: cfg.memory.enabled,
      dbPath: cfg.resolved.memorySqlitePath,
      dbExists: memoryDbExists,
    },
  };

  // Try to get more info from running instance
  if (running && cfg.ui.enabled) {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 2000);
      const res = await fetch(`http://${cfg.ui.host}:${cfg.ui.port}/api/status`, {
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = (await res.json()) as { uptime?: number };
        if (data.uptime) {
          statusInfo.uptime = data.uptime;
        }
      }
    } catch {
      // Ignore connection errors
    }
  }

  if (options.json) {
    out.json(statusInfo);
    return;
  }

  out.header("ANT Status");

  // Runtime status
  out.status("Runtime", running ? "running" : "stopped");
  if (running && pid) {
    out.keyValue("PID", pid);
  }
  if (statusInfo.uptime) {
    out.keyValue("Uptime", out.formatDuration(statusInfo.uptime));
  }

  // Paths
  out.section("Paths");
  out.keyValue("Workspace", statusInfo.workspace);
  out.keyValue("State Dir", statusInfo.stateDir);
  out.keyValue("Config", statusInfo.config);

  // UI
  out.section("Web UI");
  if (statusInfo.ui.enabled) {
    out.status("Status", running ? "running" : "stopped");
    out.keyValue("URL", statusInfo.ui.url || "N/A");
  } else {
    out.info("Web UI is disabled");
  }

  // Memory
  out.section("Memory");
  if (statusInfo.memory.enabled) {
    out.keyValue("Database", statusInfo.memory.dbPath);
    out.keyValue("Initialized", statusInfo.memory.dbExists ? "Yes" : "No");
  } else {
    out.info("Memory is disabled");
  }

  // Provider info
  out.section("Providers");
  const providers = cfg.resolved.providers;
  out.keyValue("Default", providers.default);
  for (const [name, provider] of Object.entries(providers.items)) {
    const suffix = provider.type === "cli" ? `(${provider.cliProvider})` : provider.baseUrl || "";
    out.keyValue(name, `${provider.model} ${suffix}`);
  }

  out.newline();
}

export default status;

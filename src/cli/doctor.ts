/**
 * Doctor Command - Health check inspired by OpenClaw
 */

import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import type { AntConfig } from "../config.js";
import { OutputFormatter } from "./output-formatter.js";
import chalk from "chalk";

export interface DoctorOptions {
  config?: string;
  fix?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface CheckResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
  fix?: string;
}

/**
 * Run health checks
 */
export async function doctor(cfg: AntConfig, options: DoctorOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  const results: CheckResult[] = [];

  out.header("ANT Health Check");
  out.newline();

  // Check config file
  results.push(await checkConfigFile(cfg));

  // Check workspace directory
  results.push(await checkWorkspaceDir(cfg));

  // Check state directory
  results.push(await checkStateDir(cfg));

  // Check memory database
  results.push(await checkMemoryDb(cfg));

  // Check provider connectivity
  results.push(await checkProviderConnectivity(cfg));

  // Check CLI tools
  results.push(await checkCliTools(cfg));

  // Check runtime status
  results.push(await checkRuntimeStatus(cfg));

  // Check log file
  results.push(await checkLogFile(cfg));

  // Check disk space
  results.push(await checkDiskSpace(cfg));

  if (options.json) {
    out.json(results);
    return;
  }

  // Display results
  for (const result of results) {
    const icon = result.status === "pass" ? chalk.green("✓") : result.status === "warn" ? chalk.yellow("⚠") : chalk.red("✗");
    const status = result.status === "pass" ? chalk.green("PASS") : result.status === "warn" ? chalk.yellow("WARN") : chalk.red("FAIL");

    console.log(`${icon} ${result.name.padEnd(30)} ${status}`);
    console.log(chalk.dim(`  ${result.message}`));

    if (result.status !== "pass" && result.fix) {
      console.log(chalk.yellow(`  Fix: ${result.fix}`));
    }

    console.log();
  }

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const failed = results.filter((r) => r.status === "fail").length;

  out.newline();
  console.log(chalk.bold("Summary:"));
  console.log(`  ${chalk.green(passed)} passed, ${chalk.yellow(warned)} warnings, ${chalk.red(failed)} failed`);

  if (failed > 0) {
    out.newline();
    out.error("Some checks failed. Fix the issues above to ensure ANT works correctly.");
    process.exitCode = 1;
  } else if (warned > 0) {
    out.newline();
    out.warn("Some checks have warnings. ANT should work but may have issues.");
  } else {
    out.newline();
    out.success("All checks passed! ANT is ready to use.");
  }
}

async function checkConfigFile(cfg: AntConfig): Promise<CheckResult> {
  try {
    await fs.access(cfg.resolved.configPath);
    return {
      name: "Configuration File",
      status: "pass",
      message: `Found at ${cfg.resolved.configPath}`,
    };
  } catch {
    return {
      name: "Configuration File",
      status: "fail",
      message: `Not found at ${cfg.resolved.configPath}`,
      fix: "Run 'ant onboard' to create a configuration file.",
    };
  }
}

async function checkWorkspaceDir(cfg: AntConfig): Promise<CheckResult> {
  try {
    const stats = await fs.stat(cfg.resolved.workspaceDir);
    if (stats.isDirectory()) {
      return {
        name: "Workspace Directory",
        status: "pass",
        message: cfg.resolved.workspaceDir,
      };
    }
    return {
      name: "Workspace Directory",
      status: "fail",
      message: "Path exists but is not a directory",
      fix: "Update workspaceDir in your config to point to a valid directory.",
    };
  } catch {
    return {
      name: "Workspace Directory",
      status: "fail",
      message: `Not found: ${cfg.resolved.workspaceDir}`,
      fix: "Create the directory or update workspaceDir in your config.",
    };
  }
}

async function checkStateDir(cfg: AntConfig): Promise<CheckResult> {
  try {
    await fs.access(cfg.resolved.stateDir);
    return {
      name: "State Directory",
      status: "pass",
      message: cfg.resolved.stateDir,
    };
  } catch {
    // Try to create it
    try {
      await fs.mkdir(cfg.resolved.stateDir, { recursive: true });
      return {
        name: "State Directory",
        status: "pass",
        message: `Created: ${cfg.resolved.stateDir}`,
      };
    } catch {
      return {
        name: "State Directory",
        status: "fail",
        message: `Cannot create: ${cfg.resolved.stateDir}`,
        fix: "Check permissions and disk space.",
      };
    }
  }
}

async function checkMemoryDb(cfg: AntConfig): Promise<CheckResult> {
  if (!cfg.memory.enabled) {
    return {
      name: "Memory Database",
      status: "warn",
      message: "Memory is disabled in config",
      fix: "Set memory.enabled=true to enable memory features.",
    };
  }

  try {
    await fs.access(cfg.resolved.memorySqlitePath);
    const stats = await fs.stat(cfg.resolved.memorySqlitePath);
    return {
      name: "Memory Database",
      status: "pass",
      message: `Found (${formatBytes(stats.size)})`,
    };
  } catch {
    return {
      name: "Memory Database",
      status: "warn",
      message: "Not initialized yet",
      fix: "Run 'ant start' to initialize the memory database.",
    };
  }
}

async function checkProviderConnectivity(cfg: AntConfig): Promise<CheckResult> {
  const providers = cfg.resolved.providers;
  const defaultProvider = providers.items[providers.default];

  if (!defaultProvider) {
    return {
      name: "LLM Provider",
      status: "fail",
      message: "No default provider configured",
      fix: "Configure a provider in your ant.config.json.",
    };
  }

  if (defaultProvider.type === "cli") {
    // Check if CLI tool exists
    try {
      execSync(`which ${defaultProvider.cliProvider || "codex"}`, { stdio: "ignore" });
      return {
        name: "LLM Provider",
        status: "pass",
        message: `CLI provider: ${defaultProvider.cliProvider} (${defaultProvider.model})`,
      };
    } catch {
      return {
        name: "LLM Provider",
        status: "fail",
        message: `CLI tool not found: ${defaultProvider.cliProvider}`,
        fix: `Install ${defaultProvider.cliProvider} or configure a different provider.`,
      };
    }
  }

  // OpenAI-compatible provider
  if (!defaultProvider.baseUrl) {
    return {
      name: "LLM Provider",
      status: "fail",
      message: "No baseUrl configured for OpenAI provider",
      fix: "Set provider.baseUrl in your config (e.g., http://localhost:1234/v1).",
    };
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${defaultProvider.baseUrl}/models`, {
      signal: ctrl.signal,
      headers: defaultProvider.apiKey ? { Authorization: `Bearer ${defaultProvider.apiKey}` } : {},
    });
    clearTimeout(timeout);

    if (res.ok) {
      return {
        name: "LLM Provider",
        status: "pass",
        message: `Connected to ${defaultProvider.baseUrl} (${defaultProvider.model})`,
      };
    }

    return {
      name: "LLM Provider",
      status: "warn",
      message: `Server returned ${res.status}`,
      fix: "Check if the LLM server is running and the model is loaded.",
    };
  } catch (err) {
    return {
      name: "LLM Provider",
      status: "fail",
      message: `Cannot connect to ${defaultProvider.baseUrl}`,
      fix: "Start your LLM server (LM Studio, Ollama, etc.) or check the URL.",
    };
  }
}

async function checkCliTools(cfg: AntConfig): Promise<CheckResult> {
  if (!cfg.cliTools.enabled) {
    return {
      name: "CLI Tools",
      status: "warn",
      message: "CLI tools are disabled",
      fix: "Set cliTools.enabled=true to enable CLI tool integration.",
    };
  }

  const tools: string[] = [];
  for (const [name, provider] of Object.entries(cfg.cliTools.providers)) {
    try {
      execSync(`which ${provider.command}`, { stdio: "ignore" });
      tools.push(name);
    } catch {
      // Tool not found
    }
  }

  if (tools.length === 0) {
    return {
      name: "CLI Tools",
      status: "warn",
      message: "No CLI tools found (codex, copilot, claude)",
      fix: "Install at least one CLI tool for enhanced capabilities.",
    };
  }

  return {
    name: "CLI Tools",
    status: "pass",
    message: `Available: ${tools.join(", ")}`,
  };
}

async function checkRuntimeStatus(cfg: AntConfig): Promise<CheckResult> {
  const { readPidFile } = await import("../gateway/process-control.js");
  const pid = await readPidFile(cfg);

  if (!pid) {
    return {
      name: "Runtime Status",
      status: "warn",
      message: "Agent is not running",
      fix: "Run 'ant start' to start the agent.",
    };
  }

  try {
    process.kill(pid, 0);
    return {
      name: "Runtime Status",
      status: "pass",
      message: `Running (PID: ${pid})`,
    };
  } catch {
    return {
      name: "Runtime Status",
      status: "warn",
      message: "Stale PID file (process not found)",
      fix: "Run 'ant start' to start a fresh instance.",
    };
  }
}

async function checkLogFile(cfg: AntConfig): Promise<CheckResult> {
  const logPath = cfg.resolved.logFilePath;

  try {
    const stats = await fs.stat(logPath);
    const sizeStr = formatBytes(stats.size);

    if (stats.size > 100 * 1024 * 1024) {
      return {
        name: "Log File",
        status: "warn",
        message: `Large log file: ${sizeStr}`,
        fix: "Consider rotating or clearing the log file.",
      };
    }

    return {
      name: "Log File",
      status: "pass",
      message: `${logPath} (${sizeStr})`,
    };
  } catch {
    return {
      name: "Log File",
      status: "warn",
      message: "Not created yet",
      fix: "Log file will be created when the agent runs.",
    };
  }
}

async function checkDiskSpace(cfg: AntConfig): Promise<CheckResult> {
  try {
    // Use df command to check disk space
    const output = execSync(`df -h "${cfg.resolved.stateDir}" | tail -1`, { encoding: "utf-8" });
    const parts = output.trim().split(/\s+/);
    const available = parts[3];
    const usePercent = parseInt(parts[4]);

    if (usePercent > 90) {
      return {
        name: "Disk Space",
        status: "fail",
        message: `Low disk space: ${available} available (${usePercent}% used)`,
        fix: "Free up disk space to prevent issues.",
      };
    }

    if (usePercent > 80) {
      return {
        name: "Disk Space",
        status: "warn",
        message: `${available} available (${usePercent}% used)`,
        fix: "Consider freeing up some disk space.",
      };
    }

    return {
      name: "Disk Space",
      status: "pass",
      message: `${available} available`,
    };
  } catch {
    return {
      name: "Disk Space",
      status: "warn",
      message: "Could not check disk space",
    };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default doctor;

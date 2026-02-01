/**
 * Monitoring Logs Command - Tail live logs
 */

import fs from "node:fs";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ConfigError } from "../../error-handler.js";
import chalk from "chalk";

export interface LogsOptions {
  config?: string;
  lines?: number;
  follow?: boolean;
  level?: string;
  json?: boolean;
  quiet?: boolean;
}

interface LogEntry {
  level: number;
  time: number;
  msg?: string;
  [key: string]: unknown;
}

const LEVEL_NAMES: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

const LEVEL_COLORS: Record<number, (s: string) => string> = {
  10: chalk.gray,
  20: chalk.blue,
  30: chalk.green,
  40: chalk.yellow,
  50: chalk.red,
  60: chalk.bgRed.white,
};

/**
 * Tail live logs
 */
export async function logs(cfg: AntConfig, options: LogsOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  const logPath = cfg.resolved.logFilePath;

  if (!logPath) {
    throw new ConfigError("Log file path not configured", "Set logging.filePath in your config.");
  }

  // Check if log file exists
  try {
    fs.accessSync(logPath);
  } catch {
    throw new RuntimeError("Log file not found", "Start the agent with 'ant start' to create logs.");
  }

  const numLines = options.lines ?? 50;
  const follow = options.follow !== false;
  const minLevel = parseLevel(options.level);

  if (follow) {
    out.info(`Tailing logs from ${logPath} (Ctrl+C to stop)`);
    out.newline();
    await tailLogs(logPath, numLines, minLevel, options.json ?? false);
  } else {
    await showLastLines(logPath, numLines, minLevel, options.json ?? false);
  }
}

/**
 * Parse level string to number
 */
function parseLevel(level?: string): number {
  if (!level) return 0;
  const levels: Record<string, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
  };
  return levels[level.toLowerCase()] ?? 0;
}

/**
 * Show last N lines of log file
 */
async function showLastLines(logPath: string, numLines: number, minLevel: number, asJson: boolean): Promise<void> {
  const content = fs.readFileSync(logPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);
  const lastLines = lines.slice(-numLines);

  for (const line of lastLines) {
    displayLogLine(line, minLevel, asJson);
  }
}

/**
 * Tail log file and show new lines
 */
async function tailLogs(logPath: string, initialLines: number, minLevel: number, asJson: boolean): Promise<void> {
  // Show initial lines
  await showLastLines(logPath, initialLines, minLevel, asJson);

  // Watch for changes
  let lastSize = fs.statSync(logPath).size;

  const watcher = fs.watch(logPath, async (eventType) => {
    if (eventType === "change") {
      try {
        const stats = fs.statSync(logPath);
        if (stats.size > lastSize) {
          // Read new content
          const fd = fs.openSync(logPath, "r");
          const buffer = Buffer.alloc(stats.size - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);

          const newContent = buffer.toString("utf-8");
          const newLines = newContent.split("\n").filter(Boolean);

          for (const line of newLines) {
            displayLogLine(line, minLevel, asJson);
          }

          lastSize = stats.size;
        } else if (stats.size < lastSize) {
          // Log was rotated
          lastSize = stats.size;
        }
      } catch {
        // Ignore read errors
      }
    }
  });

  // Keep process alive
  process.on("SIGINT", () => {
    watcher.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    watcher.close();
    process.exit(0);
  });

  // Wait indefinitely
  await new Promise(() => {});
}

/**
 * Display a single log line
 */
function displayLogLine(line: string, minLevel: number, asJson: boolean): void {
  if (asJson) {
    console.log(line);
    return;
  }

  try {
    const entry = JSON.parse(line) as LogEntry;

    if (entry.level < minLevel) return;

    const time = new Date(entry.time).toLocaleTimeString();
    const levelName = LEVEL_NAMES[entry.level] || "???";
    const colorFn = LEVEL_COLORS[entry.level] || ((s: string) => s);
    const msg = entry.msg || "";

    // Extract other fields
    const { level: _level, time: _time, msg: _msg, pid: _pid, hostname: _hostname, ...extra } = entry;

    let output = `${chalk.dim(time)} ${colorFn(levelName.padEnd(5))} ${msg}`;

    if (Object.keys(extra).length > 0) {
      const extraStr = Object.entries(extra)
        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join(" ");
      output += chalk.dim(` ${extraStr}`);
    }

    console.log(output);
  } catch {
    // Not JSON, just print as-is
    console.log(line);
  }
}

export default logs;

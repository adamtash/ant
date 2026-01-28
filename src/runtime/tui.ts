import fs from "node:fs/promises";

import type { CommandQueue, QueueLaneSnapshot } from "./queue.js";
import type { SubagentManager, SubagentRecord } from "./subagents.js";
import type { RuntimeStatusStore, MainTaskStatus } from "./status-store.js";

const ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

type TuiProvider = {
  label: string;
  id: string;
  type: "openai" | "cli";
  model: string;
  baseUrl?: string;
  cliProvider?: string;
};

type TuiParams = {
  queue: CommandQueue;
  subagents: SubagentManager;
  status: RuntimeStatusStore;
  runtime?: { providers: TuiProvider[] };
  logFilePath?: string;
  uiUrl?: string;
};

type TuiSnapshot = {
  running: MainTaskStatus[];
  lanes: QueueLaneSnapshot[];
  subagents: SubagentRecord[];
  logs: string[];
  time: number;
};

export function startTui(params: TuiParams): { stop: () => void } {
  if (!process.stdout.isTTY) return { stop: () => {} };

  let stopped = false;
  let paused = false;
  let showHelp = false;
  let inFlight = false;
  let snapshot: TuiSnapshot = {
    running: [],
    lanes: [],
    subagents: [],
    logs: [],
    time: Date.now(),
  };

  process.stdout.write(ALT_SCREEN + CLEAR + HIDE_CURSOR);

  const render = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const width = Math.max(80, process.stdout.columns ?? 120);
      const now = Date.now();
      if (!paused) {
        snapshot = {
          running: params.status.listRunning(),
          lanes: params.queue.snapshot(),
          subagents: params.subagents.snapshot(),
          logs: await readLastLines(params.logFilePath, 12),
          time: now,
        };
      } else {
        snapshot = { ...snapshot, time: now };
      }

      const lines: string[] = [];
      const title = "ANT runtime";
      const statusLine = paused ? "paused" : "live";
      lines.push(padRight(`${title} · ${statusLine}`, width));
      lines.push(padRight(`updated: ${new Date(snapshot.time).toLocaleTimeString()}`, width));
      lines.push(padRight("-".repeat(Math.min(width, 120)), width));

      const left: string[] = [];
      const right: string[] = [];

      if (params.runtime?.providers?.length) {
        left.push("Runtime providers");
        for (const entry of params.runtime.providers) {
          left.push(truncate(formatProvider(entry), Math.floor(width / 2) - 2));
        }
        left.push("");
      }

      left.push("Main agent");
      if (snapshot.running.length === 0) {
        left.push("  idle");
      } else {
        for (const entry of snapshot.running.slice(0, 6)) {
          const duration = formatDuration(snapshot.time - entry.startedAt);
          const task = truncate(entry.text, Math.floor(width / 2) - 28);
          const started = formatTime(entry.startedAt);
          left.push(`  ${started}  ${duration}  ${task}`);
        }
      }

      left.push("");
      left.push("Queue lanes");
      if (snapshot.lanes.length === 0) {
        left.push("  none");
      } else {
        for (const lane of snapshot.lanes.slice(0, 8)) {
          const queued = `${lane.active}/${lane.maxConcurrent} active, ${lane.queued} queued`;
          const wait =
            lane.oldestEnqueuedAt !== undefined
              ? `oldest wait ${formatDuration(snapshot.time - lane.oldestEnqueuedAt)}`
              : "idle";
          const line = `  ${lane.lane}: ${queued}, ${wait}`;
          left.push(truncate(line, Math.floor(width / 2) - 2));
        }
      }

      right.push("Logs");
      if (snapshot.logs.length === 0) {
        right.push("  (no logs yet)");
      } else {
        for (const line of snapshot.logs) {
          right.push(truncate(`  ${line}`, Math.floor(width / 2) - 2));
        }
      }

      right.push("");
      right.push("Subagents");
      if (snapshot.subagents.length === 0) {
        right.push("  none");
      } else {
        for (const entry of snapshot.subagents.slice(0, 6)) {
          right.push(formatSubagent(entry, snapshot.time, Math.floor(width / 2) - 2));
        }
      }

      const merged = mergeColumns(left, right, width, 2);
      lines.push(...merged);

      const footerLeft = showHelp
        ? "keys: p pause · q quit · ? help"
        : "press ? for help";
      const footerRight = params.uiUrl ? `web: ${params.uiUrl}` : "";
      lines.push(padRight(mergeFooter(footerLeft, footerRight, width), width));

      const output = lines.join("\n");
      process.stdout.write(CLEAR + output);
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => void render(), 500);
  void render();

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      const input = chunk.toString("utf-8");
      if (input === "q" || input === "\u0003") {
        stop();
        process.exit(0);
      }
      if (input === "p") {
        paused = !paused;
        void render();
      }
      if (input === "?") {
        showHelp = !showHelp;
        void render();
      }
    });
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeAllListeners("data");
    }
  };

  process.once("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    stop();
    process.exit(0);
  });

  return { stop };
}

async function readLastLines(filePath: string | undefined, lines: number): Promise<string[]> {
  if (!filePath) return [];
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const all = raw.split("\n").filter(Boolean);
    const limit = Number.isFinite(lines) && lines > 0 ? lines : 12;
    return all.slice(Math.max(0, all.length - limit));
  } catch {
    return [];
  }
}

function mergeColumns(left: string[], right: string[], width: number, gap: number): string[] {
  const leftWidth = Math.floor((width - gap) / 2);
  const rightWidth = width - gap - leftWidth;
  const rows = Math.max(left.length, right.length);
  const merged: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const leftLine = padRight(truncate(left[i] ?? "", leftWidth), leftWidth);
    const rightLine = padRight(truncate(right[i] ?? "", rightWidth), rightWidth);
    merged.push(`${leftLine}${" ".repeat(gap)}${rightLine}`);
  }
  return merged;
}

function mergeFooter(left: string, right: string, width: number): string {
  const space = width - left.length - right.length;
  if (space <= 1) return truncate(`${left} ${right}`.trim(), width);
  return `${left}${" ".repeat(space)}${right}`;
}

function formatSubagent(entry: SubagentRecord, now: number, width: number): string {
  const status = entry.status.padEnd(8);
  const startedAt = entry.startedAt ?? entry.createdAt;
  const duration = entry.endedAt
    ? formatDuration(entry.endedAt - startedAt)
    : formatDuration(now - startedAt);
  const label = entry.label ? ` (${entry.label})` : "";
  const task = truncate(entry.task, width - 30);
  return `  ${status} ${duration} ${task}${label}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max <= 3) return value.slice(0, max);
  return value.slice(0, max - 3) + "...";
}

function padRight(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function formatProvider(entry: {
  label: string;
  id: string;
  type: "openai" | "cli";
  model: string;
  baseUrl?: string;
  cliProvider?: string;
}): string {
  const target = entry.type === "cli" ? entry.cliProvider || "cli" : entry.baseUrl || "n/a";
  return `  ${entry.label}: ${entry.id} (${entry.type}) ${entry.model} @ ${target}`;
}

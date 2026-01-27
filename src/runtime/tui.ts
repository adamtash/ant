import type { CommandQueue, QueueLaneSnapshot } from "./queue.js";
import type { SubagentManager, SubagentRecord } from "./subagents.js";
import type { RuntimeStatusStore, MainTaskStatus } from "./status-store.js";

const ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export function startTui(params: {
  queue: CommandQueue;
  subagents: SubagentManager;
  status: RuntimeStatusStore;
}): { stop: () => void } {
  if (!process.stdout.isTTY) return { stop: () => {} };

  let stopped = false;
  process.stdout.write(ALT_SCREEN + CLEAR + HIDE_CURSOR);

  const render = () => {
    if (stopped) return;
    const width = Math.max(60, process.stdout.columns ?? 120);
    const now = Date.now();
    const lines: string[] = [];

    lines.push(padRight("ant runtime monitor", width));
    lines.push(padRight(`updated: ${new Date(now).toLocaleTimeString()}`, width));
    lines.push(padRight("-".repeat(Math.min(width, 80)), width));

    const running = params.status.listRunning();
    lines.push("Main agent");
    if (running.length === 0) {
      lines.push("  idle");
    } else {
      for (const entry of running.slice(0, 6)) {
        const duration = formatDuration(now - entry.startedAt);
        const task = truncate(entry.text, width - 28);
        const started = formatTime(entry.startedAt);
        lines.push(`  ${started}  ${duration}  ${task}`);
      }
    }

    const lanes = params.queue.snapshot();
    lines.push("");
    lines.push("Queue lanes");
    if (lanes.length === 0) {
      lines.push("  none");
    } else {
      for (const lane of lanes.slice(0, 8)) {
        const queued = `${lane.active}/${lane.maxConcurrent} active, ${lane.queued} queued`;
        const wait =
          lane.oldestEnqueuedAt !== undefined
            ? `oldest wait ${formatDuration(now - lane.oldestEnqueuedAt)}`
            : "idle";
        const line = `  ${lane.lane}: ${queued}, ${wait}`;
        lines.push(truncate(line, width));
      }
    }

    const subagents = params.subagents.snapshot();
    lines.push("");
    lines.push("Subagents");
    if (subagents.length === 0) {
      lines.push("  none");
    } else {
      for (const entry of subagents.slice(0, 6)) {
        lines.push(formatSubagent(entry, now, width));
      }
    }

    const output = lines.join("\n");
    process.stdout.write(CLEAR + output);
  };

  const interval = setInterval(render, 500);
  render();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
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

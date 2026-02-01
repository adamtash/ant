/**
 * Agent List Tasks Command - Show active tasks
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";

export interface ListTasksOptions {
  config?: string;
  all?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface Task {
  id: string;
  description: string;
  label?: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

/**
 * Show active tasks
 */
export async function listTasks(cfg: AntConfig, options: ListTasksOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!cfg.ui.enabled) {
    throw new RuntimeError("List-tasks requires the web UI to be enabled", "Enable ui.enabled in your config.");
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const url = options.all ? `${base}/api/tasks?all=true` : `${base}/api/tasks`;
    const res = await fetch(url);

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Failed to get tasks: ${error}`);
    }

    const data = (await res.json()) as { ok: boolean; tasks: Task[] };
    const tasks = data.tasks || [];

    if (options.json) {
      out.json(tasks);
      return;
    }

    if (tasks.length === 0) {
      out.info(options.all ? "No tasks found." : "No active tasks. Use --all to see completed tasks.");
      return;
    }

    out.header("Tasks");

    out.table(
      tasks.map((task) => ({
        id: task.id.slice(0, 8),
        status: task.status,
        label: task.label || "-",
        description: task.description.slice(0, 40) + (task.description.length > 40 ? "..." : ""),
        duration: task.startedAt
          ? out.formatDuration((task.completedAt || Date.now()) - task.startedAt)
          : "-",
      })),
      [
        { key: "id", header: "ID", width: 10 },
        { key: "status", header: "Status", width: 12 },
        { key: "label", header: "Label", width: 15 },
        { key: "description", header: "Description", width: 43 },
        { key: "duration", header: "Duration", width: 10, align: "right" },
      ]
    );

    out.newline();
    const running = tasks.filter((t) => t.status === "running").length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    out.info(`${running} running, ${pending} pending`);
  } catch (err) {
    if (err instanceof RuntimeError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

export default listTasks;

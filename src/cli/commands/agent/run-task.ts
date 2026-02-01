/**
 * Agent Run Task Command - Spawn a long-running task
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError } from "../../error-handler.js";

export interface RunTaskOptions {
  config?: string;
  label?: string;
  wait?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface TaskResponse {
  id: string;
  status: string;
  label?: string;
  createdAt: number;
}

/**
 * Spawn a long-running task
 */
export async function runTask(cfg: AntConfig, description: string, options: RunTaskOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!description?.trim()) {
    throw new ValidationError("Task description cannot be empty", 'Provide a description: ant run-task "your task"');
  }

  if (!cfg.ui.enabled) {
    throw new RuntimeError("Run-task requires the web UI to be enabled", "Enable ui.enabled in your config or use 'ant ask' for one-off questions.");
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  const stopProgress = out.progress("Spawning task...");

  try {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: description.trim(),
        label: options.label,
      }),
    });

    stopProgress();

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Failed to create task: ${error}`);
    }

    const data = (await res.json()) as TaskResponse;

    if (options.json) {
      out.json(data);
      return;
    }

    out.success(`Task created: ${data.id}`);
    if (data.label) {
      out.keyValue("Label", data.label);
    }
    out.keyValue("Status", data.status);

    if (options.wait) {
      out.newline();
      out.info("Waiting for task to complete...");
      await waitForTask(cfg, data.id, out);
    } else {
      out.newline();
      out.info(`Use 'ant list-tasks' to check status or 'ant run-task --wait' to wait for completion.`);
    }
  } catch (err) {
    stopProgress();

    if (err instanceof RuntimeError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

/**
 * Wait for a task to complete
 */
async function waitForTask(cfg: AntConfig, taskId: string, out: OutputFormatter): Promise<void> {
  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
  const startTime = Date.now();

  while (true) {
    try {
      const res = await fetch(`${base}/api/tasks/${taskId}`);

      if (!res.ok) {
        throw new RuntimeError(`Failed to get task status: ${await res.text()}`);
      }

      const data = (await res.json()) as { status: string; result?: string; error?: string };

      if (data.status === "completed") {
        out.success(`Task completed in ${out.formatDuration(Date.now() - startTime)}`);
        if (data.result) {
          out.newline();
          out.box(data.result, "Result");
        }
        return;
      }

      if (data.status === "failed") {
        throw new RuntimeError(`Task failed: ${data.error || "Unknown error"}`);
      }

      // Still running, wait and check again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } catch (err) {
      if (err instanceof RuntimeError) throw err;
      throw new RuntimeError(`Lost connection to runtime: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export default runTask;

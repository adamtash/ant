/**
 * Schedule Remove Command - Remove a scheduled job
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError } from "../../error-handler.js";

export interface ScheduleRemoveOptions {
  config?: string;
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Remove a scheduled job
 */
export async function scheduleRemove(cfg: AntConfig, jobId: string, options: ScheduleRemoveOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!jobId?.trim()) {
    throw new ValidationError("Job ID is required", "Use 'ant schedule list' to see available jobs.");
  }

  if (!cfg.ui.enabled) {
    throw new RuntimeError("Schedule requires the web UI to be enabled", "Enable ui.enabled in your config.");
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const res = await fetch(`${base}/api/schedule/${encodeURIComponent(jobId)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Failed to remove job: ${error}`);
    }

    if (options.json) {
      out.json({ success: true, jobId });
      return;
    }

    out.success(`Removed scheduled job: ${jobId}`);
  } catch (err) {
    if (err instanceof RuntimeError || err instanceof ValidationError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

export default scheduleRemove;

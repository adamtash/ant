/**
 * Schedule Run Command - Manually run a scheduled job
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError } from "../../error-handler.js";

export interface ScheduleRunOptions {
  config?: string;
  wait?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface RunResult {
  jobId: string;
  success: boolean;
  result?: string;
  error?: string;
  duration: number;
}

/**
 * Manually run a scheduled job
 */
export async function scheduleRun(cfg: AntConfig, jobId: string, options: ScheduleRunOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!jobId?.trim()) {
    throw new ValidationError("Job ID is required", "Use 'ant schedule list' to see available jobs.");
  }

  if (!cfg.ui.enabled) {
    throw new RuntimeError("Schedule requires the web UI to be enabled", "Enable ui.enabled in your config.");
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  const stopProgress = out.progress(`Running job ${jobId}...`);

  try {
    const startTime = Date.now();
    const res = await fetch(`${base}/api/schedule/${encodeURIComponent(jobId)}/run`, {
      method: "POST",
    });

    if (!res.ok) {
      stopProgress();
      const error = await res.text();
      throw new RuntimeError(`Failed to run job: ${error}`);
    }

    const result = (await res.json()) as RunResult;
    stopProgress();

    if (options.json) {
      out.json(result);
      return;
    }

    if (result.success) {
      out.success(`Job completed in ${out.formatDuration(result.duration || Date.now() - startTime)}`);
      if (result.result) {
        out.newline();
        out.box(result.result, "Result");
      }
    } else {
      out.error(`Job failed: ${result.error || "Unknown error"}`);
    }
  } catch (err) {
    stopProgress();

    if (err instanceof RuntimeError || err instanceof ValidationError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

export default scheduleRun;

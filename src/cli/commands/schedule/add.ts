/**
 * Schedule Add Command - Add a new scheduled job
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError } from "../../error-handler.js";

export interface ScheduleAddOptions {
  config?: string;
  name?: string;
  prompt?: string;
  tool?: string;
  args?: string;
  enabled?: boolean;
  json?: boolean;
  quiet?: boolean;
}

interface ScheduleJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  createdAt: number;
}

/**
 * Add a new scheduled job
 */
export async function scheduleAdd(
  cfg: AntConfig,
  schedule: string,
  options: ScheduleAddOptions = {}
): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!schedule?.trim()) {
    throw new ValidationError(
      "Schedule expression is required",
      'Provide a cron expression: ant schedule add "0 9 * * *" --prompt "Good morning"'
    );
  }

  if (!options.prompt && !options.tool) {
    throw new ValidationError(
      "Either --prompt or --tool is required",
      'Use --prompt for agent prompts or --tool for direct tool calls'
    );
  }

  // Validate cron expression (basic check)
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    throw new ValidationError(
      "Invalid cron expression",
      'Use standard cron format: "minute hour day month weekday" (e.g., "0 9 * * *" for 9 AM daily)'
    );
  }

  if (!cfg.ui.enabled) {
    throw new RuntimeError(
      "Schedule requires the web UI to be enabled",
      "Enable ui.enabled in your config."
    );
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const body: Record<string, unknown> = {
      schedule: schedule.trim(),
      name: options.name || `Job ${Date.now()}`,
      enabled: options.enabled !== false,
    };

    if (options.prompt) {
      body.trigger = {
        type: "agent_ask",
        prompt: options.prompt,
      };
    } else if (options.tool) {
      body.trigger = {
        type: "tool_call",
        tool: options.tool,
        args: options.args ? JSON.parse(options.args) : {},
      };
    }

    const res = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Failed to create scheduled job: ${error}`);
    }

    const job = (await res.json()) as ScheduleJob;

    if (options.json) {
      out.json(job);
      return;
    }

    out.success(`Scheduled job created: ${job.id}`);
    out.keyValue("Name", job.name);
    out.keyValue("Schedule", job.schedule);
    out.keyValue("Status", job.enabled ? "enabled" : "disabled");
    out.newline();
    out.info("Use 'ant schedule list' to see all jobs.");
  } catch (err) {
    if (err instanceof RuntimeError || err instanceof ValidationError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

export default scheduleAdd;

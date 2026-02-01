/**
 * Schedule List Command - List all scheduled jobs
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";

export interface ScheduleListOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

interface ScheduleJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRun?: number;
  lastResult?: "success" | "failure";
  nextRun?: number;
  trigger: {
    type: "agent_ask" | "tool_call" | "webhook";
    prompt?: string;
    tool?: string;
  };
}

/**
 * List all scheduled jobs
 */
export async function scheduleList(cfg: AntConfig, options: ScheduleListOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!cfg.ui.enabled) {
    throw new RuntimeError("Schedule requires the web UI to be enabled", "Enable ui.enabled in your config.");
  }

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const res = await fetch(`${base}/api/schedule`);

    if (!res.ok) {
      const error = await res.text();
      throw new RuntimeError(`Failed to get scheduled jobs: ${error}`);
    }

    const jobs = (await res.json()) as ScheduleJob[];

    if (options.json) {
      out.json(jobs);
      return;
    }

    if (jobs.length === 0) {
      out.info("No scheduled jobs. Use 'ant schedule add' to create one.");
      return;
    }

    out.header("Scheduled Jobs");

    out.table(
      jobs.map((job) => ({
        id: job.id.slice(0, 8),
        name: job.name.slice(0, 20),
        schedule: job.schedule,
        status: job.enabled ? "enabled" : "disabled",
        type: job.trigger.type.replace("_", " "),
        lastRun: job.lastRun ? out.formatTime(job.lastRun) : "never",
        result: job.lastResult || "-",
      })),
      [
        { key: "id", header: "ID", width: 10 },
        { key: "name", header: "Name", width: 22 },
        { key: "schedule", header: "Schedule", width: 15 },
        { key: "status", header: "Status", width: 10 },
        { key: "type", header: "Type", width: 12 },
        { key: "lastRun", header: "Last Run", width: 20 },
        { key: "result", header: "Result", width: 8 },
      ]
    );

    out.newline();
    const enabled = jobs.filter((j) => j.enabled).length;
    out.info(`${enabled}/${jobs.length} jobs enabled`);
  } catch (err) {
    if (err instanceof RuntimeError) throw err;

    if (err instanceof Error && err.message.includes("ECONNREFUSED")) {
      throw new RuntimeError("Agent runtime is not running", "Start the agent with 'ant start'");
    }

    throw err;
  }
}

export default scheduleList;

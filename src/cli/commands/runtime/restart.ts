/**
 * Runtime Restart Command - Restart the running agent
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, stopAnt } from "../../../gateway/process-control.js";
import { start } from "./start.js";

export interface RestartOptions {
  config?: string;
  tui?: boolean;
  detached?: boolean;
  quiet?: boolean;
}

/**
 * Restart the running agent
 */
export async function restart(cfg: AntConfig, options: RestartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  // Check if running
  const pid = await readPidFile(cfg);
  if (!pid) {
    throw new RuntimeError("Agent is not running", "Use 'ant start' to start the agent first.");
  }

  out.info("Stopping agent runtime...");
  const stopped = await stopAnt(cfg);
  if (!stopped) {
    throw new RuntimeError("Failed to stop agent", "Try 'ant stop --force' to force stop.");
  }

  out.info("Starting agent runtime...");
  await start(cfg, { tui: options.tui, detached: options.detached, quiet: options.quiet });
}

export default restart;

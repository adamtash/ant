/**
 * Runtime Stop Command - Stop the running agent
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { readPidFile, stopAnt } from "../../../gateway/process-control.js";

export interface StopOptions {
  config?: string;
  force?: boolean;
  quiet?: boolean;
}

/**
 * Stop the running agent
 */
export async function stop(cfg: AntConfig, options: StopOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  // Check if running
  const pid = await readPidFile(cfg);
  if (!pid) {
    out.warn("Agent does not appear to be running.");
    return;
  }

  out.info("Stopping agent runtime...");

  const success = await stopAnt(cfg);

  if (success) {
    out.success("Agent stopped successfully.");
  } else {
    throw new RuntimeError("Failed to stop agent", options.force ? undefined : "Try 'ant stop --force' to force stop.");
  }
}

export default stop;

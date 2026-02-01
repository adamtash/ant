/**
 * Runtime Restart Command - Restart the running agent
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError } from "../../error-handler.js";
import { restartAnt, isRunning } from "../../../gateway/process-control.js";

export interface RestartOptions {
  config?: string;
  quiet?: boolean;
}

/**
 * Restart the running agent
 */
export async function restart(cfg: AntConfig, options: RestartOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  // Check if running
  const running = await isRunning(cfg);
  if (!running) {
    throw new RuntimeError("Agent is not running", "Use 'ant start' to start the agent first.");
  }

  out.info("Restarting agent runtime...");

  const success = await restartAnt(cfg);

  if (success) {
    out.success("Agent restart initiated.");

    if (cfg.ui.enabled) {
      const url = cfg.ui.openUrl || `http://${cfg.ui.host}:${cfg.ui.port}`;
      out.info(`Web UI will be available at: ${url}`);
    }
  } else {
    throw new RuntimeError("Failed to restart agent", "Make sure the agent was running and try again.");
  }
}

export default restart;

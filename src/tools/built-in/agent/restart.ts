/**
 * Restart ANT Tool - Trigger graceful restart of the agent
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "restart_ant",
    description: "Restart the ANT agent runtime. Uses the configured restart command.",
    category: "agent",
    version: "1.0.0",
  },
  parameters: defineParams({
    reason: { type: "string", description: "Optional reason for the restart" },
    resumeTask: { type: "string", description: "Optional task to resume after restart" },
  }, []),
  async execute(args, ctx): Promise<ToolResult> {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "Requested by agent";
    const resumeTask = typeof args.resumeTask === "string" ? args.resumeTask.trim() : undefined;

    try {
      // Save restart context
      const restartFile = path.join(ctx.stateDir, "restart.json");
      const restartContext = {
        requested: true,
        requestedAt: Date.now(),
        reason,
        target: "all",
        resumeTask,
        sessionKey: ctx.sessionKey,
      };

      await fs.mkdir(ctx.stateDir, { recursive: true });
      await fs.writeFile(restartFile, JSON.stringify(restartContext, null, 2), "utf-8");

      ctx.logger.info({ reason, resumeTask }, "Restart requested");

      // Schedule process exit after a short delay
      setTimeout(() => {
        process.exit(0);
      }, 2000);

      return {
        ok: true,
        data: {
          scheduled: true,
          reason,
          resumeTask,
          message: "Restart scheduled. Agent will restart shortly.",
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

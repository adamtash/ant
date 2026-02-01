/**
 * Open App Tool - Open desktop applications on macOS
 */

import { spawn } from "node:child_process";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "open_app",
    description: "Open a desktop application by name (macOS only).",
    category: "system",
    version: "1.0.0",
  },
  parameters: defineParams({
    name: { type: "string", description: "Application name (e.g., 'Safari', 'Terminal')" },
  }, ["name"]),
  async execute(args, ctx): Promise<ToolResult> {
    if (process.platform !== "darwin") {
      return { ok: false, error: "This tool is only available on macOS" };
    }

    const appName = String(args.name).trim();
    if (!appName) {
      return { ok: false, error: "Application name is required" };
    }

    const result = await runCommand({
      command: "open",
      args: ["-a", appName],
      timeoutMs: 30_000,
    });

    if (!result.ok) {
      return {
        ok: false,
        error: `Failed to open ${appName}: ${result.stderr || "Application not found"}`,
      };
    }

    return {
      ok: true,
      data: {
        app: appName,
        opened: true,
      },
    };
  },
});

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

async function runCommand(params: {
  command: string;
  args: string[];
  timeoutMs: number;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(params.command, params.args);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutMs);

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr || String(err) });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, stdout, stderr });
    });
  });
}

/**
 * Screenshot Tool - Capture screen on macOS
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "screenshot",
    description: "Capture a screenshot (macOS only). Returns the path to the saved image.",
    category: "system",
    version: "1.0.0",
  },
  parameters: defineParams({
    send: { type: "boolean", description: "If true, mark for sending to chat (default true)" },
    caption: { type: "string", description: "Optional caption for the screenshot" },
  }, []),
  async execute(args, ctx): Promise<ToolResult> {
    if (process.platform !== "darwin") {
      return { ok: false, error: "Screenshot capture is only supported on macOS" };
    }

    const send = args.send !== false;
    const caption = typeof args.caption === "string" ? args.caption : undefined;

    try {
      const outputDir = path.join(ctx.stateDir, "captures");
      await fs.mkdir(outputDir, { recursive: true });

      const filePath = path.join(outputDir, `screenshot-${Date.now()}.png`);

      const result = await runCommand({
        command: "screencapture",
        args: ["-x", filePath],
        timeoutMs: 30_000,
      });

      if (!result.ok) {
        return {
          ok: false,
          error: `screencapture failed: ${result.stderr || "unknown error"}. ` +
            "Grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording.",
        };
      }

      return {
        ok: true,
        data: {
          path: filePath,
          send,
          caption,
        },
        metadata: {
          mediaPath: send ? filePath : undefined,
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

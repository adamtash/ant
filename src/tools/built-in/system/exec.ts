/**
 * Shell Exec Tool - Run shell commands
 */

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "exec",
    description: "Run a shell command on the host machine. Returns stdout, stderr, and exit code.",
    category: "system",
    version: "1.0.0",
  },
  parameters: defineParams({
    command: { type: "string", description: "The command to run" },
    args: { type: "array", description: "Command arguments as array" },
    cwd: { type: "string", description: "Working directory (defaults to workspace)" },
    timeoutMs: { type: "number", description: "Timeout in milliseconds (max 300000, default 60000)" },
  }, ["command"]),
  async execute(args, ctx): Promise<ToolResult> {
    const command = String(args.command);
    if (!command) {
      return { ok: false, error: "command is required" };
    }

    const argsList = Array.isArray(args.args)
      ? args.args.map((a: unknown) => String(a))
      : [];

    const cwd = args.cwd
      ? resolvePath(String(args.cwd), ctx.workspaceDir)
      : ctx.workspaceDir;

    const timeoutMs = typeof args.timeoutMs === "number" && args.timeoutMs > 0
      ? Math.min(args.timeoutMs, 300_000)
      : 60_000;

    const result = await runCommand({ command, args: argsList, cwd, timeoutMs });

    return {
      ok: result.ok,
      data: result.ok ? {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      } : undefined,
      error: result.ok ? undefined : result.stderr || "Command failed",
      metadata: {
        timedOut: result.timedOut,
      },
    };
  },
});

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

async function runCommand(params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: process.env,
      shell: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutMs);

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr || String(err),
        exitCode: null,
        timedOut,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        timedOut,
      });
    });
  });
}

function resolvePath(value: string, workspaceDir: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("path is required");
  if (trimmed.startsWith("~")) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(workspaceDir, trimmed);
}

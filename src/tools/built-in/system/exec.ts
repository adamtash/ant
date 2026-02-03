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

    ctx.logger.info(
      {
        tool: "exec",
        command,
        args: argsList,
        cwd,
        timeoutMs,
      },
      "Exec command started"
    );

    if (shouldBlockDeletes()) {
      const fullCommand = [command, ...argsList].join(" ").trim();
      const violation = detectDeleteCommand(fullCommand);
      if (violation) {
        ctx.logger.warn(
          { tool: "exec", fullCommand, reason: violation },
          "Blocked potentially destructive exec command"
        );
        return { ok: false, error: `Blocked delete command in exec: ${violation}` };
      }
    }

    const result = await runCommand({ command, args: argsList, cwd, timeoutMs });

    const stdoutPreview = result.stdout.length > 400 ? result.stdout.slice(0, 400) + "…(truncated)" : result.stdout;
    const stderrPreview = result.stderr.length > 400 ? result.stderr.slice(0, 400) + "…(truncated)" : result.stderr;

    if (result.ok) {
      ctx.logger.info(
        {
          tool: "exec",
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          stdoutPreview,
          stderrPreview,
        },
        "Exec command completed"
      );
    } else {
      ctx.logger.warn(
        {
          tool: "exec",
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdoutLength: result.stdout.length,
          stderrLength: result.stderr.length,
          stdoutPreview,
          stderrPreview,
        },
        "Exec command failed"
      );
    }

    return {
      ok: result.ok,
      data: result.ok ? {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      } : undefined,
      error: result.ok
        ? undefined
        : result.timedOut
          ? `Command timed out after ${timeoutMs}ms`
          : result.stderr || "Command failed",
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

function shouldBlockDeletes(): boolean {
  const value = (process.env.ANT_EXEC_BLOCK_DELETE || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function detectDeleteCommand(fullCommand: string): string | null {
  const raw = fullCommand.trim();
  if (!raw) return null;

  const normalized = raw.toLowerCase();

  // Common delete operations (Unix + Windows + PowerShell)
  const deleteBins = [
    /\brm\b/,
    /\bunlink\b/,
    /\brmdir\b/,
    /\bdel\b/,
    /\berase\b/,
    /\btrash\b/,
    /\bremove-item\b/,
  ];
  if (deleteBins.some((re) => re.test(normalized))) {
    return "matched delete binary";
  }

  // find ... -delete
  if (/\bfind\b/.test(normalized) && /\s-delete(\s|$)/.test(normalized)) {
    return "matched find -delete";
  }

  // git clean (deletes untracked files)
  if (/\bgit\b/.test(normalized) && /\bclean\b/.test(normalized) && /\s-(?:f|fd|xdf)(\s|$)/.test(normalized)) {
    return "matched git clean";
  }

  // Common delete patterns via scripting languages (bypass rm/del)
  const pythonDelete = [
    /\bos\.remove\b/,
    /\bos\.unlink\b/,
    /\bshutil\.rmtree\b/,
    /\bpathlib\.path\b.*\bunlink\b/,
    /\bpathlib\.path\b.*\brmdir\b/,
  ];
  if (pythonDelete.some((re) => re.test(normalized))) {
    return "matched python delete";
  }

  const nodeDelete = [
    /\bfs\.\s*unlink\b/,
    /\bfs\.\s*rm\b/,
    /\bfs\.\s*rmdir\b/,
    /\bfs\.\s*unlinksync\b/,
    /\bfs\.\s*rmsync\b/,
    /\bfs\.\s*rmdirsync\b/,
    /\brimraf\b/,
  ];
  if (nodeDelete.some((re) => re.test(normalized))) {
    return "matched node delete";
  }

  return null;
}

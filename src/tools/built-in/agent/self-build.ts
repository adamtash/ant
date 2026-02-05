/**
 * Self Build Tool - Build and validate the repo, then request restart.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "self_build",
    description: "Build and validate the ANT repo, then request a supervised restart.",
    category: "agent",
    version: "1.0.0",
  },
  parameters: defineParams({
    reason: { type: "string", description: "Optional reason for the self-build" },
  }, []),
  async execute(args, ctx): Promise<ToolResult> {
    const reason = typeof args.reason === "string" ? args.reason.trim() : "";
    const cfg = ctx.antConfig;
    if (!cfg) {
      return { ok: false, error: "antConfig not available in tool context" };
    }
    if (!cfg.runtime.selfBuild.enabled) {
      return { ok: false, error: "Self-build is disabled in runtime.selfBuild.enabled" };
    }

    const repoRoot = cfg.resolved.repoRoot ?? ctx.workspaceDir;
    const commands = cfg.runtime.selfBuild.commands;
    const maxFixAttempts = cfg.runtime.selfBuild.maxFixAttempts ?? 0;
    const steps: Array<{ name: string; command: string; run: boolean }> = [];

    const uiTouched = await detectUiTouched(repoRoot).catch(() => true);

    steps.push({ name: "build", command: commands.build, run: true });
    steps.push({ name: "ui:build", command: commands.uiBuild, run: uiTouched });
    steps.push({ name: "typecheck", command: commands.typecheck, run: true });
    steps.push({ name: "test", command: commands.test, run: true });
    steps.push({ name: "diagnostics", command: commands.diagnostics, run: true });

    const results: Array<{ name: string; ok: boolean; exitCode: number | null; stdout: string; stderr: string }> = [];

    for (const step of steps) {
      if (!step.run) {
        results.push({ name: step.name, ok: true, exitCode: 0, stdout: "skipped", stderr: "" });
        continue;
      }

      let attempt = 0;
      while (true) {
        const result = await runCommand(step.command, repoRoot, 30 * 60_000);
        results.push({ name: step.name, ok: result.ok, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
        if (result.ok) break;

        attempt += 1;
        if (attempt > maxFixAttempts) {
          if (cfg.runtime.selfBuild.notifyOwnersOnFailure && ctx.notifyOwners) {
            const msg = `❌ Self-build failed at step '${step.name}'. ${reason ? `Reason: ${reason}. ` : ""}Error: ${result.stderr || result.stdout || "unknown"}`;
            await ctx.notifyOwners(msg).catch(() => undefined);
          }
          return {
            ok: false,
            error: `Self-build failed at step '${step.name}' (attempts ${attempt}/${maxFixAttempts}).`,
            data: { results },
          };
        }

        await attemptAutoFix({ cfg, repoRoot, step: step.name, stdout: result.stdout, stderr: result.stderr });
      }
    }

    await requestRestart(ctx.stateDir, reason || "self_build_succeeded", { steps: results });

    return {
      ok: true,
      data: {
        message: "Self-build completed. Restart requested.",
        results,
      },
    };
  },
});

async function detectUiTouched(repoRoot: string): Promise<boolean> {
  const uiDir = path.join(repoRoot, "ui");
  if (!fsSync.existsSync(uiDir)) return false;

  const status = await runCommand("git status --porcelain", repoRoot, 10_000);
  if (!status.ok) {
    return true;
  }

  const lines = status.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.some((line) => line.includes(" ui/") || line.endsWith("ui/") || line.includes("ui/"));
}

async function attemptAutoFix(params: {
  cfg: ToolContext["antConfig"];
  repoRoot: string;
  step: string;
  stdout: string;
  stderr: string;
}): Promise<void> {
  if (!params.cfg) return;
  const prompt = [
    "Self-build failed.",
    `Step: ${params.step}`,
    params.stderr ? `Error: ${params.stderr}` : "",
    params.stdout ? `Output: ${params.stdout}` : "",
    "Fix the issue in the repository. Do not run self_build. Return a short summary of changes.",
  ].filter(Boolean).join("\n\n");

  const distCli = path.join(params.repoRoot, "dist", "cli.js");
  const args = fsSync.existsSync(distCli)
    ? [`node ${distCli} ask`, JSON.stringify(prompt)]
    : [`npm run dev -- ask`, JSON.stringify(prompt)];

  await runCommand(args.join(" "), params.repoRoot, 15 * 60_000);
}

async function requestRestart(stateDir: string, reason: string, metadata?: Record<string, unknown>): Promise<void> {
  const restartFile = path.join(stateDir, "restart.json");
  const payload = {
    requested: true,
    requestedAt: Date.now(),
    reason,
    message: "Self-build complete; restarting.",
    target: "all",
    metadata,
  };

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(restartFile, JSON.stringify(payload, null, 2), "utf-8");

  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

async function runCommand(command: string, cwd: string, timeoutMs: number): Promise<{ ok: boolean; exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(command, {
      cwd,
      env: { ...process.env, ANT_SELF_BUILD: "1" },
      shell: true,
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr: stderr || String(err) });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

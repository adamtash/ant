import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AntConfig } from "../config.js";
import type { Logger } from "../log.js";
import type { MemoryManager } from "../memory/index.js";
import type { SessionStore } from "./session-store.js";
import type { SubagentManager } from "./subagents.js";
import { runCliProvider, type CliProvider } from "./cli-tools.js";

export type ToolContext = {
  cfg: AntConfig;
  logger: Logger;
  memory: MemoryManager;
  sessions: SessionStore;
  subagents: SubagentManager;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  sendMedia: (
    chatId: string,
    payload: { filePath: string; type?: "image" | "video" | "document"; caption?: string },
  ) => Promise<void>;
  requester?: { sessionKey: string; chatId: string };
};

export type ToolCallResult = {
  content: string;
};

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: unknown, ctx: ToolContext) => Promise<ToolCallResult>;
};

export function buildTools(ctx: ToolContext): Tool[] {
  const tools: Tool[] = [];

  tools.push({
    name: "read",
    description: "Read a text file from disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        from: { type: "number" },
        lines: { type: "number" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { path: "string" }) as {
        path: string;
        from?: number;
        lines?: number;
      };
      const filePath = resolvePath(parsed.path, ctx.cfg.resolved.workspaceDir);
      const raw = await fs.readFile(filePath, "utf-8");
      const allLines = raw.split("\n");
      const from = parsed.from && parsed.from > 0 ? parsed.from - 1 : 0;
      const lines = parsed.lines && parsed.lines > 0 ? parsed.lines : allLines.length;
      const slice = allLines.slice(from, from + lines);
      return { content: JSON.stringify({ path: filePath, text: slice.join("\n") }) };
    },
  });

  tools.push({
    name: "write",
    description: "Write a text file to disk (optionally append).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        append: { type: "boolean" },
      },
      required: ["path", "content"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { path: "string", content: "string" }) as {
        path: string;
        content: string;
        append?: boolean;
      };
      const filePath = resolvePath(parsed.path, ctx.cfg.resolved.workspaceDir);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      if (parsed.append) {
        await fs.appendFile(filePath, parsed.content, "utf-8");
      } else {
        await fs.writeFile(filePath, parsed.content, "utf-8");
      }
      return { content: JSON.stringify({ ok: true, path: filePath }) };
    },
  });

  tools.push({
    name: "ls",
    description: "List files in a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    },
    execute: async (args, ctx) => {
      const parsed = typeof args === "string" ? safeJsonParse(args) : args;
      const dir = parsed?.path
        ? resolvePath(String(parsed.path), ctx.cfg.resolved.workspaceDir)
        : ctx.cfg.resolved.workspaceDir;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return {
        content: JSON.stringify({
          path: dir,
          entries: entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
          })),
        }),
      };
    },
  });

  tools.push({
    name: "exec",
    description: "Run a shell command on the host machine.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
    execute: async (args, ctx) => {
      const parsed = typeof args === "string" ? safeJsonParse(args) : args;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("invalid tool arguments");
      }
      const command = String((parsed as any).command ?? "");
      if (!command) throw new Error("command is required");
      const argsList = Array.isArray((parsed as any).args)
        ? (parsed as any).args.map((entry: any) => String(entry))
        : [];
      const cwd = (parsed as any).cwd
        ? resolvePath(String((parsed as any).cwd), ctx.cfg.resolved.workspaceDir)
        : ctx.cfg.resolved.workspaceDir;
      const timeoutMs =
        typeof (parsed as any).timeoutMs === "number" && (parsed as any).timeoutMs > 0
          ? Math.min((parsed as any).timeoutMs, 300_000)
          : 60_000;
      const result = await runCommand({ command, args: argsList, cwd, timeoutMs });
      return { content: JSON.stringify(result) };
    },
  });

  tools.push({
    name: "open_app",
    description: "Open a desktop application by name (macOS only).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
    },
    execute: async (args, ctx) => {
      if (process.platform !== "darwin") {
        return { content: JSON.stringify({ ok: false, error: "macOS only" }) };
      }
      const parsed = readArgs(args, { name: "string" }) as { name: string };
      const result = await runCommand({
        command: "open",
        args: ["-a", parsed.name],
        cwd: ctx.cfg.resolved.workspaceDir,
        timeoutMs: 30_000,
      });
      return { content: JSON.stringify(result) };
    },
  });

  tools.push({
    name: "restart_ant",
    description: "Restart the ant runtime using the configured restart command.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (_args, ctx) => {
      const restart = ctx.cfg.runtime?.restart;
      if (!restart?.command) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "restart not configured",
            hint: "Set runtime.restart.command/args in ant.config.json.",
          }),
        };
      }
      const argsList = Array.isArray(restart.args) ? restart.args : [];
      const cwd = restart.cwd
        ? resolvePath(restart.cwd, ctx.cfg.resolved.workspaceDir)
        : ctx.cfg.resolved.workspaceDir;
      ctx.logger.info({ command: restart.command, args: argsList, cwd }, "restart requested");
      const child = spawn(restart.command, argsList, {
        cwd,
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      setTimeout(() => process.exit(0), 2000);
      return {
        content: JSON.stringify({
          ok: true,
          started: { command: restart.command, args: argsList, cwd },
        }),
      };
    },
  });

  tools.push({
    name: "bird",
    description:
      "Run the bird CLI for Twitter/X access (read/search/tweet). Requires bird installed.",
    parameters: {
      type: "object",
      properties: {
        args: { type: "array", items: { type: "string" } },
      },
      required: ["args"],
    },
    execute: async (args, ctx) => {
      const parsed = typeof args === "string" ? safeJsonParse(args) : args;
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).args)) {
        throw new Error("invalid tool arguments");
      }
      const argsList = (parsed as any).args.map((entry: any) => String(entry));
      const command = resolveBirdCommand();
      const result = await runCommand({
        command,
        args: argsList,
        cwd: ctx.cfg.resolved.workspaceDir,
        timeoutMs: 120_000,
      });
      if (!result.ok && isMissingBinary(result)) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "bird CLI not found",
            hint:
              "Install bird via: `brew install steipete/tap/bird` (macOS) or `npm install -g @steipete/bird`.",
            docs: "https://github.com/steipete/bird",
          }),
        };
      }
      return { content: JSON.stringify(result) };
    },
  });

  tools.push({
    name: "browser",
    description:
      "Automate a headless browser to fetch rendered page text or screenshots. Requires Playwright.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        action: { type: "string", enum: ["extract", "html", "screenshot"] },
        selector: { type: "string" },
        waitMs: { type: "number" },
        fullPage: { type: "boolean" },
        send: { type: "boolean" },
        caption: { type: "string" },
      },
      required: ["url", "action"],
    },
    execute: async (args, ctx) => {
      const parsed = typeof args === "string" ? safeJsonParse(args) : args;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("invalid tool arguments");
      }
      const url = String((parsed as any).url ?? "");
      const action = String((parsed as any).action ?? "");
      const selector = (parsed as any).selector ? String((parsed as any).selector) : undefined;
      const waitMs =
        typeof (parsed as any).waitMs === "number" && (parsed as any).waitMs > 0
          ? Math.min((parsed as any).waitMs, 60_000)
          : 0;
      const fullPage = typeof (parsed as any).fullPage === "boolean" ? (parsed as any).fullPage : true;
      const send = typeof (parsed as any).send === "boolean" ? (parsed as any).send : false;
      const caption = typeof (parsed as any).caption === "string" ? (parsed as any).caption : undefined;
      if (!url || !action) {
        throw new Error("url and action are required");
      }

      const pw = await loadPlaywright();
      if (!pw.ok) {
        return { content: JSON.stringify(pw) };
      }

      const browser = await pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (waitMs > 0) {
          await page.waitForTimeout(waitMs);
        }
        if (action === "extract") {
          const text = selector
            ? await page.locator(selector).innerText()
            : await page.locator("body").innerText();
          return { content: JSON.stringify({ ok: true, url, text }) };
        }
        if (action === "html") {
          const html = await page.content();
          return { content: JSON.stringify({ ok: true, url, html }) };
        }
        if (action === "screenshot") {
          const outputDir = path.join(ctx.cfg.resolved.stateDir, "captures");
          await fs.mkdir(outputDir, { recursive: true });
          const filePath = path.join(outputDir, `browser-${Date.now()}.png`);
          await page.screenshot({ path: filePath, fullPage });
          if (send && ctx.requester?.chatId) {
            await ctx.sendMedia(ctx.requester.chatId, { filePath, type: "image", caption });
          }
          return { content: JSON.stringify({ ok: true, url, path: filePath, sent: Boolean(send) }) };
        }
        return { content: JSON.stringify({ ok: false, error: `unknown action: ${action}` }) };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  });

  tools.push({
    name: "memory_search",
    description:
      "Search MEMORY.md + memory/*.md + session transcripts for relevant context. Returns snippets with path + line numbers.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
        minScore: { type: "number" },
      },
      required: ["query"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { query: "string" });
      try {
        const results = await ctx.memory.search(parsed.query, parsed.maxResults, parsed.minScore);
        return { content: JSON.stringify({ results }) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = message.includes("No models loaded")
          ? "Load an embeddings-capable model in LM Studio or set memory.enabled=false."
          : undefined;
        return {
          content: JSON.stringify({
            results: [],
            error: message,
            hint,
          }),
        };
      }
    },
  });

  tools.push({
    name: "memory_get",
    description:
      "Read a snippet from MEMORY.md or memory/*.md. Use after memory_search to pull specific lines.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        from: { type: "number" },
        lines: { type: "number" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { path: "string" }) as {
        path: string;
        from?: number;
        lines?: number;
      };
      try {
        const result = await ctx.memory.readFile({
          relPath: parsed.path,
          from: parsed.from,
          lines: parsed.lines,
        });
        return { content: JSON.stringify(result) };
      } catch (err) {
        return {
          content: JSON.stringify({
            path: parsed.path,
            text: "",
            error: err instanceof Error ? err.message : String(err),
          }),
        };
      }
    },
  });

  tools.push({
    name: "sessions_spawn",
    description: "Spawn a subagent to handle a task in parallel.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string" },
        label: { type: "string" },
      },
      required: ["task"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { task: "string" });
      const run = await ctx.subagents.spawn({
        task: parsed.task,
        label: parsed.label,
        requester: ctx.requester,
      });
      return { content: JSON.stringify(run) };
    },
  });

  tools.push({
    name: "sessions_send",
    description: "Send a message to another session (if known).",
    parameters: {
      type: "object",
      properties: {
        sessionKey: { type: "string" },
        message: { type: "string" },
      },
      required: ["sessionKey", "message"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { sessionKey: "string", message: "string" });
      const target = ctx.sessions.getSessionContext(parsed.sessionKey);
      if (!target?.lastChatId) {
        return { content: JSON.stringify({ ok: false, error: "unknown session" }) };
      }
      await ctx.sendMessage(target.lastChatId, parsed.message);
      return { content: JSON.stringify({ ok: true }) };
    },
  });

  tools.push({
    name: "message_send",
    description: "Send a WhatsApp message to a specific chat ID.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string" },
        message: { type: "string" },
      },
      required: ["to", "message"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { to: "string", message: "string" });
      await ctx.sendMessage(parsed.to, parsed.message);
      return { content: JSON.stringify({ ok: true }) };
    },
  });

  tools.push({
    name: "send_file",
    description: "Send a file to WhatsApp (image/video/document).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        type: { type: "string", enum: ["image", "video", "document"] },
        caption: { type: "string" },
      },
      required: ["path"],
    },
    execute: async (args, ctx) => {
      const parsed = readArgs(args, { path: "string" }) as {
        path: string;
        type?: "image" | "video" | "document";
        caption?: string;
      };
      const filePath = resolvePath(parsed.path, ctx.cfg.resolved.workspaceDir);
      ctx.logger.debug({ filePath, type: parsed.type }, "send_file: captured");
      return { content: `MEDIA:${filePath}` };
    },
  });

  tools.push({
    name: "screenshot",
    description: "Capture a screenshot and optionally send it to WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        send: { type: "boolean" },
        caption: { type: "string" },
      },
    },
    execute: async (_args, ctx) => {
      const parsed = typeof _args === "string" ? safeJsonParse(_args) : _args;
      const send = typeof parsed?.send === "boolean" ? parsed.send : true;
      const caption = typeof parsed?.caption === "string" ? parsed.caption : undefined;
      ctx.logger.debug({ send }, "screenshot: capture start");
      const filePath = await captureScreenshot(ctx.cfg);
      ctx.logger.debug({ filePath }, "screenshot: captured");
      if (send) {
        return { content: `MEDIA:${filePath}` };
      }
      return { content: JSON.stringify({ ok: true, path: filePath, sent: false, caption }) };
    },
  });

  tools.push({
    name: "screen_record",
    description: "Record a short screen video and optionally send it to WhatsApp.",
    parameters: {
      type: "object",
      properties: {
        durationSeconds: { type: "number" },
        send: { type: "boolean" },
        caption: { type: "string" },
      },
    },
    execute: async (_args, ctx) => {
      const parsed = typeof _args === "string" ? safeJsonParse(_args) : _args;
      const durationSeconds =
        typeof parsed?.durationSeconds === "number" && parsed.durationSeconds > 0
          ? Math.min(parsed.durationSeconds, 120)
          : 10;
      const send = typeof parsed?.send === "boolean" ? parsed.send : true;
      const caption = typeof parsed?.caption === "string" ? parsed.caption : undefined;
      ctx.logger.debug({ durationSeconds, send }, "screen_record: capture start");
      const filePath = await captureScreenRecording(ctx.cfg, durationSeconds);
      ctx.logger.debug({ filePath }, "screen_record: captured");
      if (send) {
        return { content: `MEDIA:${filePath}` };
      }
      return {
        content: JSON.stringify({ ok: true, path: filePath, sent: false, caption }),
      };
    },
  });

  tools.push({
    name: "macos_permissions",
    description: "Open macOS privacy settings needed for screen capture and automation.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async (_args, ctx) => {
      if (process.platform !== "darwin") {
        return { content: JSON.stringify({ ok: false, error: "macOS only" }) };
      }
      const targets = [
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
      ];
      for (const target of targets) {
        await runCommand({ command: "open", args: [target], cwd: ctx.cfg.resolved.workspaceDir, timeoutMs: 10_000 }).catch(
          () => {},
        );
      }
      return {
        content: JSON.stringify({
          ok: true,
          opened: targets,
          note: "Enable Terminal (or your Node binary) for Screen Recording and Accessibility as needed.",
        }),
      };
    },
  });

  if (ctx.cfg.cliTools.enabled) {
    tools.push({
      name: "external_cli",
      description:
        "Run an external CLI assistant (codex, copilot, claude) with a prompt. Uses configured binary/args; output returned as text.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["codex", "copilot", "claude"] },
          prompt: { type: "string" },
        },
        required: ["provider", "prompt"],
      },
      execute: async (args, ctx) => {
        const parsed = readArgs(args, { provider: "string", prompt: "string" });
        const provider = parsed.provider as CliProvider;
        if (!["codex", "copilot", "claude"].includes(provider)) {
          return { content: JSON.stringify({ ok: false, error: "unknown provider" }) };
        }
        const result = await runCliProvider({
          cfg: ctx.cfg,
          provider,
          prompt: parsed.prompt,
        });
        const output = truncateOutput(result.output);
        return {
          content: JSON.stringify({
            ok: result.ok,
            provider,
            output,
            stderr: result.stderr,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          }),
        };
      },
    });
  }

  return tools;
}

function readArgs(args: unknown, schema: Record<string, "string" | "number">) {
  const parsed = typeof args === "string" ? safeJsonParse(args) : args;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid tool arguments");
  }
  const out: Record<string, unknown> = { ...parsed };
  for (const [key, type] of Object.entries(schema)) {
    if (!(key in out)) continue;
    const value = out[key];
    if (type === "string" && typeof value !== "string") {
      throw new Error(`invalid tool argument: ${key}`);
    }
    if (type === "number" && typeof value !== "number") {
      throw new Error(`invalid tool argument: ${key}`);
    }
  }
  return out as Record<string, any>;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function truncateOutput(value: string, max = 8000): string {
  if (!value) return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated]`;
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

async function captureScreenshot(cfg: AntConfig): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("screenshot capture is only supported on macOS for now");
  }
  const outputDir = path.join(cfg.resolved.stateDir, "captures");
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `screenshot-${Date.now()}.png`);
  const result = await runCommand({
    command: "screencapture",
    args: ["-x", filePath],
    cwd: cfg.resolved.workspaceDir,
    timeoutMs: 30_000,
  });
  if (!result.ok) {
    throw new Error(
      `screencapture failed: ${result.stderr || result.stdout || "unknown error"}. ` +
        "Grant Screen Recording permission to Terminal in System Settings → Privacy & Security → Screen Recording.",
    );
  }
  return filePath;
}

async function captureScreenRecording(cfg: AntConfig, durationSeconds: number): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("screen recording is only supported on macOS for now");
  }
  const outputDir = path.join(cfg.resolved.stateDir, "captures");
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `recording-${Date.now()}.mov`);
  const result = await runTimedCommand({
    command: "screencapture",
    args: ["-v", filePath],
    cwd: cfg.resolved.workspaceDir,
    durationMs: Math.max(1000, Math.round(durationSeconds * 1000)),
    timeoutMs: Math.max(10_000, Math.round(durationSeconds * 1000) + 10_000),
  });
  if (!result.ok) {
    throw new Error(
      `screen recording failed: ${result.stderr || result.stdout || "unknown error"}. ` +
        "Grant Screen Recording permission to Terminal in System Settings → Privacy & Security → Screen Recording.",
    );
  }
  return filePath;
}

async function runCommand(params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}> {
  return runTimedCommand({ ...params, durationMs: undefined });
}

async function runTimedCommand(params: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  durationMs?: number;
}): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: process.env,
    });
    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, params.timeoutMs);
    const stopTimer =
      typeof params.durationMs === "number"
        ? setTimeout(() => {
            child.kill("SIGINT");
          }, params.durationMs)
        : null;

    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > 2_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      if (stopTimer) clearTimeout(stopTimer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr || String(err),
        exitCode: null,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (stopTimer) clearTimeout(stopTimer);
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

function resolveBirdCommand(): string {
  const env = process.env.BIRD_BIN?.trim();
  if (env) return env;
  return "bird";
}

function isMissingBinary(result: { stderr: string; stdout: string; exitCode: number | null }) {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();
  return combined.includes("enoent") || combined.includes("not found");
}

async function loadPlaywright(): Promise<
  | { ok: true; chromium: typeof import("playwright").chromium }
  | { ok: false; error: string; hint: string }
> {
  try {
    const mod = await import("playwright");
    return { ok: true, chromium: mod.chromium };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      hint: "Install Playwright: `npm install playwright` then `npx playwright install chromium`.",
    };
  }
}

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

import type { AntConfig } from "../config.js";
import type { Logger } from "../log.js";
import type { MemoryManager } from "../memory/index.js";
import type { CommandQueue, QueueDetailSnapshot } from "./queue.js";
import type { RuntimeStatusStore } from "./status-store.js";
import type { SubagentManager } from "./subagents.js";
import type { ProviderClients } from "./providers.js";
import type { SessionStore } from "./session-store.js";
import type { AgentRunner } from "./agent.js";
import type { WhatsAppStatusStore } from "./whatsapp-status.js";

type UiServerParams = {
  cfg: AntConfig;
  logger: Logger;
  queue: CommandQueue;
  status: RuntimeStatusStore;
  subagents: SubagentManager;
  providers: ProviderClients;
  memory: MemoryManager;
  sessions: SessionStore;
  agent: AgentRunner;
  whatsappStatus: WhatsAppStatusStore;
};

export function startUiServer(params: UiServerParams): { stop: () => Promise<void> } {
  const { cfg, logger } = params;
  if (!cfg.ui.enabled) return { stop: async () => {} };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    setCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const apiPath = pathname.startsWith("/api/") ? pathname.slice(4) : null;
      if (apiPath) {
        if (req.method === "GET" && apiPath === "/status") {
          return sendJson(res, 200, buildStatus(params));
        }
        if (req.method === "GET" && apiPath === "/queue/detail") {
          return sendJson(res, 200, buildQueueDetail(params.queue.snapshotDetail()));
        }
        if (req.method === "GET" && apiPath === "/health") {
          return sendJson(res, 200, { ok: true, status: "ok", time: Date.now() });
        }
        if (req.method === "GET" && apiPath === "/logs") {
          const lines = Number(url.searchParams.get("lines") ?? "200");
          const data = await readLastLines(cfg.resolved.logFilePath, lines);
          return sendJson(res, 200, { ok: true, lines: data });
        }
        if (req.method === "GET" && apiPath === "/logs/stream") {
          return await streamLogs(req, res, cfg.resolved.logFilePath);
        }
        if (req.method === "GET" && apiPath === "/config") {
          const raw = await fs.readFile(cfg.resolved.configPath, "utf-8");
          return sendJson(res, 200, { ok: true, path: cfg.resolved.configPath, config: JSON.parse(raw) });
        }
        if (req.method === "PUT" && apiPath === "/config") {
          const body = await readJsonBody(req);
          await fs.writeFile(cfg.resolved.configPath, JSON.stringify(body, null, 2), "utf-8");
          return sendJson(res, 200, { ok: true, restartRequired: true });
        }
        if (req.method === "GET" && apiPath === "/tools") {
          return sendJson(res, 200, {
            ok: true,
            toggles: {
              memory: cfg.memory.enabled,
              cliTools: cfg.cliTools.enabled,
              subagents: cfg.subagents.enabled,
              browser: cfg.browser.enabled,
            },
          });
        }
        if (req.method === "PUT" && apiPath === "/tools") {
          const body = await readJsonBody(req);
          const raw = await fs.readFile(cfg.resolved.configPath, "utf-8");
          const parsed = JSON.parse(raw);
          if (body?.toggles) {
            if (typeof body.toggles.memory === "boolean") parsed.memory.enabled = body.toggles.memory;
            if (typeof body.toggles.cliTools === "boolean")
              parsed.cliTools.enabled = body.toggles.cliTools;
            if (typeof body.toggles.subagents === "boolean")
              parsed.subagents.enabled = body.toggles.subagents;
            if (typeof body.toggles.browser === "boolean") parsed.browser.enabled = body.toggles.browser;
          }
          await fs.writeFile(cfg.resolved.configPath, JSON.stringify(parsed, null, 2), "utf-8");
          return sendJson(res, 200, { ok: true, restartRequired: true });
        }
        if (req.method === "GET" && apiPath === "/sessions") {
          const sessions = await params.sessions.listSessions();
          return sendJson(res, 200, { ok: true, sessions });
        }
        if (req.method === "GET" && apiPath.startsWith("/sessions/")) {
          const sessionKey = decodeURIComponent(apiPath.replace("/sessions/", ""));
          const messages = await params.sessions.readMessages(sessionKey);
          return sendJson(res, 200, { ok: true, sessionKey, messages });
        }
        if (req.method === "POST" && apiPath === "/chat") {
          const body = await readJsonBody(req);
          const message = String(body?.message ?? "");
          if (!message.trim()) return sendJson(res, 400, { ok: false, error: "message required" });
          const sessionKey = String(body?.sessionKey ?? "ui:default");
          await params.sessions.appendMessage(sessionKey, {
            role: "user",
            content: message,
            ts: Date.now(),
          });
          const reply = await params.agent.runTask({
            sessionKey,
            task: message,
            isSubagent: false,
          });
          await params.sessions.appendMessage(sessionKey, {
            role: "assistant",
            content: reply,
            ts: Date.now(),
          });
          return sendJson(res, 200, { ok: true, reply });
        }
        if (req.method === "POST" && apiPath === "/memory/search") {
          const body = await readJsonBody(req);
          const query = String(body?.query ?? "");
          const results = await params.memory.search(query);
          return sendJson(res, 200, { ok: true, results });
        }
        if (req.method === "GET" && apiPath === "/memory/stats") {
          const stats = await readMemoryStats(cfg);
          return sendJson(res, 200, { ok: true, stats });
        }
        if (req.method === "GET" && apiPath === "/whatsapp/status") {
          return sendJson(res, 200, { ok: true, status: params.whatsappStatus.get() });
        }
        if (req.method === "GET" && apiPath === "/install/status") {
          const status = await getInstallStatus(cfg);
          return sendJson(res, 200, { ok: true, status });
        }
        if (req.method === "POST" && apiPath === "/restart") {
          const restart = cfg.runtime?.restart;
          if (!restart?.command) {
            return sendJson(res, 400, {
              ok: false,
              error: "restart not configured",
              hint: "Set runtime.restart.command/args in ant.config.json.",
            });
          }
          spawnDetached(restart.command, restart.args ?? [], restart.cwd ?? cfg.resolved.workspaceDir);
          sendJson(res, 200, { ok: true });
          setTimeout(() => process.exit(0), 1500);
          return;
        }
        if (req.method === "POST" && apiPath === "/stop") {
          sendJson(res, 200, { ok: true });
          setTimeout(() => process.exit(0), 500);
          return;
        }
        if (req.method === "POST" && apiPath === "/start") {
          const start = cfg.runtime?.start;
          if (!start?.command) {
            return sendJson(res, 400, {
              ok: false,
              error: "start not configured",
              hint: "Set runtime.start.command/args in ant.config.json.",
            });
          }
          spawnDetached(start.command, start.args ?? [], start.cwd ?? cfg.resolved.workspaceDir);
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 404, { ok: false, error: "not found" });
      }

      const served = await tryServeStatic({
        req,
        res,
        rootDir: cfg.resolved.uiStaticDir,
      });
      if (served) return;

      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  void killPortIfBusy(cfg.ui.port, cfg.ui.host, logger).finally(() => {
    server.listen(cfg.ui.port, cfg.ui.host, () => {
    logger.info({ host: cfg.ui.host, port: cfg.ui.port }, "ui server listening");
    if (cfg.ui.autoOpen) {
      const url = cfg.ui.openUrl?.trim() || `http://${cfg.ui.host}:${cfg.ui.port}`;
      openInBrowser(url);
    }
  });
  });

  return {
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function tryServeStatic(params: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  rootDir: string;
}): Promise<boolean> {
  const { req, res, rootDir } = params;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) return false;

  const normalized = path.posix.normalize(pathname);
  if (normalized.includes("..")) return false;

  const filePath = normalized === "/" ? "index.html" : normalized.slice(1);
  const resolved = path.join(rootDir, filePath);

  if (await sendFileIfExists(res, resolved)) return true;

  const accept = String(req.headers.accept ?? "");
  if (accept.includes("text/html")) {
    const indexPath = path.join(rootDir, "index.html");
    if (await sendFileIfExists(res, indexPath)) return true;
  }

  return false;
}

async function sendFileIfExists(res: http.ServerResponse, filePath: string): Promise<boolean> {
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = contentTypeForExt(ext);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
    return true;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

function contentTypeForExt(ext: string): string {
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf-8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function buildStatus(params: UiServerParams) {
  const providers = [
    { label: "chat", ...params.providers.resolveProvider("chat") },
    { label: "tools", ...params.providers.resolveProvider("tools") },
    { label: "summary", ...params.providers.resolveProvider("summary") },
    { label: "subagent", ...params.providers.resolveProvider("subagent") },
    { label: "embeddings", ...params.providers.resolveProvider("embeddings") },
  ].map((entry) => ({
    label: entry.label,
    id: entry.id,
    type: entry.type,
    model: entry.modelForAction,
    baseUrl: entry.baseUrl ?? "",
    cliProvider: entry.cliProvider,
  }));

  return {
    ok: true,
    time: Date.now(),
    runtime: {
      providers,
    },
    queue: params.queue.snapshot(),
    running: params.status.listRunning(),
    subagents: params.subagents.snapshot(),
  };
}

function buildQueueDetail(lanes: QueueDetailSnapshot[]) {
  return {
    ok: true,
    lanes,
  };
}


async function readLastLines(filePath: string, lines: number): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const all = raw.split("\n").filter(Boolean);
    const limit = Number.isFinite(lines) && lines > 0 ? lines : 200;
    return all.slice(Math.max(0, all.length - limit));
  } catch {
    return [];
  }
}

async function streamLogs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: ready\ndata: ok\n\n");

  let position = 0;
  let buffer = "";
  const initial = await readLastLines(filePath, 200);
  for (const line of initial) {
    res.write(`event: log\ndata: ${escapeSse(line)}\n\n`);
  }
  const tick = async () => {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size < position) {
        position = 0;
      }
      if (stat.size === position) return;
      const file = await fs.open(filePath, "r");
      const length = stat.size - position;
      const buf = Buffer.alloc(length);
      await file.read(buf, 0, length, position);
      await file.close();
      position = stat.size;
      buffer += buf.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        res.write(`event: log\ndata: ${escapeSse(line)}\n\n`);
      }
    } catch {
      // ignore
    }
  };
  const interval = setInterval(tick, 1000);
  req.on("close", () => clearInterval(interval));
}

function escapeSse(input: string): string {
  return input.replace(/\r?\n/g, " ");
}

async function readMemoryStats(cfg: AntConfig) {
  const syncPath = path.join(cfg.resolved.stateDir, "memory-sync.json");
  try {
    const raw = await fs.readFile(syncPath, "utf-8");
    const parsed = JSON.parse(raw) as { lastRunAt?: number; files?: Record<string, unknown> };
    return {
      enabled: cfg.memory.enabled,
      lastRunAt: parsed.lastRunAt ?? 0,
      fileCount: Object.keys(parsed.files ?? {}).length,
    };
  } catch {
    return { enabled: cfg.memory.enabled, lastRunAt: 0, fileCount: 0 };
  }
}

async function getInstallStatus(cfg: AntConfig) {
  let playwright = { installed: false, executablePath: "" };
  try {
    const mod = await import("playwright");
    const executablePath = mod.chromium.executablePath();
    playwright = { installed: Boolean(executablePath), executablePath };
  } catch {
    playwright = { installed: false, executablePath: "" };
  }
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    playwright,
    logFile: cfg.resolved.logFilePath,
  };
}

function spawnDetached(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" });
  child.unref();
}

function openInBrowser(url: string) {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // ignore open failures
  }
}

function killPortIfBusy(port: number, host: string, logger: Logger): Promise<void> {
  if (!Number.isFinite(port)) return Promise.resolve();
  const args = ["-ti", `tcp:${port}`, "-sTCP:LISTEN"];
  return new Promise((resolve) => {
    execFile("lsof", args, (err, stdout) => {
      if (err) return resolve();
      const pids = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => Number(line))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
      if (pids.length === 0) return resolve();
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
          logger.warn({ pid, port, host }, "killed process on ui port");
        } catch {
          // ignore kill errors
        }
      }
      resolve();
    });
  });
}

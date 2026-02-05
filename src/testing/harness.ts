/**
 * ANT Programmatic Test Harness
 *
 * Goals:
 * - Drive inbound WhatsApp-like messages programmatically
 * - Observe outbound responses and persisted session logs
 * - Capture logs for analysis and iterative product polishing
 *
 * Supports:
 * - In-process runtime (fast, best observability)
 * - Child-process runtime (realistic, closest to CLI usage)
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { loadConfig, type AntConfig } from "../config.js";
import { createLoggerWithCleanup } from "../log.js";
import { MessageRouter } from "../channels/router.js";
import { TestWhatsAppAdapter, type TestWhatsAppInboundMessage, type TestWhatsAppOutboundMessage } from "../channels/whatsapp/test-adapter.js";
import { createAgentEngine } from "../agent/engine.js";
import { SessionManager } from "../gateway/session-manager.js";
import { collectToolMediaAttachments } from "../utils/tool-media.js";
import { collectToolOutboundMessages } from "../utils/tool-outbound.js";

export type HarnessMode = "in_process" | "child_process";
export type HarnessLaunchTarget = "src" | "dist";

export interface HarnessOptions {
  /**
   * Base config path to copy and override for an isolated run.
   * Defaults to `ant.config.json` in the current working directory.
   */
  configPath?: string;

  /** Use an isolated temp state dir (recommended). */
  isolated?: boolean;

  /** Workspace dir override (defaults to repo cwd). */
  workspaceDir?: string;

  /** Enable memory for the run (defaults to false in harness mode). */
  enableMemory?: boolean;

  /** Enable main agent for the run (defaults to false in harness mode). */
  enableMainAgent?: boolean;

  /** Enable scheduler for the run (defaults to false in harness mode). */
  enableScheduler?: boolean;

  /** Block deletion-like commands in `exec` tool via env guard. */
  blockExecDeletes?: boolean;

  /** Self JID used by the test WhatsApp adapter. */
  testSelfJid?: string;

  /** Child-process entrypoint target. */
  launchTarget?: HarnessLaunchTarget;
}

export interface HarnessRunArtifacts {
  runId: string;
  tempDir: string;
  configPath: string;
  stateDir: string;
  logFilePath: string;
  gatewayUrl?: string;
}

export interface HarnessInstance {
  readonly mode: HarnessMode;
  readonly cfg: AntConfig;
  readonly artifacts: HarnessRunArtifacts;

  sendWhatsAppText(message: TestWhatsAppInboundMessage): Promise<{ accepted: boolean; sessionKey?: string; messageId?: string }>;
  listWhatsAppOutbound(filter?: { chatId?: string; sessionKey?: string }): Promise<TestWhatsAppOutboundMessage[]>;
  clearWhatsAppOutbound(): Promise<void>;
  waitForWhatsAppOutbound(params: {
    chatId?: string;
    sessionKey?: string;
    timeoutMs?: number;
    contains?: string;
  }): Promise<TestWhatsAppOutboundMessage>;
  readLogs(params?: { maxBytes?: number }): Promise<string>;
  stop(): Promise<void>;
}

export async function startHarness(mode: HarnessMode, options: HarnessOptions = {}): Promise<HarnessInstance> {
  const runId = `harness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseConfigPath = path.resolve(options.configPath ?? "ant.config.json");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `ant-harness-${runId}-`));
  const stateDir = path.join(tempDir, ".ant");
  await fs.mkdir(stateDir, { recursive: true });

  const gatewayPort = await findAvailablePort(0);
  const uiPort = await findAvailablePort(0);

  const harnessConfigPath = path.join(tempDir, "harness.config.json");
  await writeHarnessConfig({
    baseConfigPath,
    outPath: harnessConfigPath,
    runId,
    stateDir,
    gatewayPort,
    uiPort,
    options,
  });

  const cfg = await loadConfig(harnessConfigPath);

  if (mode === "in_process") {
    return startInProcessHarness(cfg, {
      runId,
      tempDir,
      configPath: harnessConfigPath,
      stateDir: cfg.resolved.stateDir,
      logFilePath: cfg.resolved.logFilePath,
    }, options);
  }

  return startChildProcessHarness(cfg, {
    runId,
    tempDir,
    configPath: harnessConfigPath,
    stateDir: cfg.resolved.stateDir,
    logFilePath: cfg.resolved.logFilePath,
  }, options);
}

// ============================================================================
// In-process harness
// ============================================================================

async function startInProcessHarness(
  cfg: AntConfig,
  artifacts: HarnessRunArtifacts,
  options: HarnessOptions
): Promise<HarnessInstance> {
  applyHarnessEnv(options);

  const { logger, close: closeLogger } = createLoggerWithCleanup(cfg.logging.level, cfg.resolved.logFilePath, cfg.resolved.logFileLevel, {
    console: false,
  });

  const router = new MessageRouter({
    logger,
    sessionOrdering: {
      enabled: true,
      maxConcurrentSessions: 3,
      queueTimeoutMs: 300_000,
    },
  });
  router.start();

  const whatsapp = new TestWhatsAppAdapter({
    cfg,
    logger,
    selfJid: options.testSelfJid,
  });
  await whatsapp.start();
  router.registerAdapter(whatsapp);

  const sessionManager = new SessionManager({
    stateDir: cfg.resolved.stateDir,
    logger,
  });
  await sessionManager.initialize();

  const agentEngine = await createAgentEngine({
    config: {
      maxHistoryTokens: cfg.agent.maxHistoryTokens,
      temperature: cfg.agent.temperature,
      maxToolIterations: cfg.agent.maxToolIterations,
      toolLoop: cfg.agent.toolLoop,
      compaction: cfg.agent.compaction,
      thinking: cfg.agent.thinking,
      toolPolicy: cfg.agent.toolPolicy,
      toolResultGuard: cfg.agent.toolResultGuard,
    },
    antConfig: cfg,
    providerConfig: {
      providers: cfg.resolved.providers.items as any,
      defaultProvider: cfg.resolved.providers.default,
      routing: cfg.resolved.routing,
      fallbackChain: cfg.resolved.providers.fallbackChain,
      allowCliToolCalls: cfg.cliTools.allowToolCalls,
    },
    logger,
    workspaceDir: cfg.resolved.workspaceDir,
    stateDir: cfg.resolved.stateDir,
    toolPolicies: cfg.toolPolicies,
    sessionManager,
    onProviderError: async () => {
      // In harness mode, provider errors are best observed via logs/session output.
    },
  });

  // Persist user/assistant messages like the gateway does (for artifacts + assertions)
  router.on("event", async (event) => {
    if (event.type === "message_received") {
      if (event.message.sender.isAgent) return;
      await sessionManager.appendMessage(event.message.context.sessionKey, {
        role: "user",
        content: event.message.content,
        timestamp: event.message.timestamp,
        channel: event.message.channel,
        chatId: event.message.context.chatId,
        name: event.message.sender.name,
      });
      return;
    }

    if (event.type === "message_sent") {
      if (!event.message.sender.isAgent) return;
      const providerId =
        typeof event.message.metadata?.providerId === "string"
          ? String(event.message.metadata.providerId)
          : undefined;
      const model =
        typeof event.message.metadata?.model === "string"
          ? String(event.message.metadata.model)
          : undefined;
      await sessionManager.appendMessage(event.message.context.sessionKey, {
        role: "assistant",
        content: event.message.content,
        timestamp: event.message.timestamp,
        channel: event.message.channel,
        chatId: event.message.context.chatId,
        providerId,
        model,
        metadata: {
          ...(typeof event.message.metadata === "object" && event.message.metadata
            ? (event.message.metadata as Record<string, unknown>)
            : {}),
          ...(event.message.media
            ? {
                media: {
                  type: event.message.media.type,
                  filename: event.message.media.filename,
                  mimeType: event.message.media.mimeType,
                  path: typeof event.message.media.data === "string" ? event.message.media.data : undefined,
                  bytes: Buffer.isBuffer(event.message.media.data) ? event.message.media.data.length : undefined,
                },
              }
            : {}),
          ...(event.error ? { sendError: event.error } : {}),
          sendOk: event.success,
        },
      });
    }
  });

  // Route inbound messages to the agent engine
  router.setDefaultHandler(async (message) => {
    const startedAt = Date.now();
    const result = await agentEngine.execute({
      sessionKey: message.context.sessionKey,
      query: message.content,
      chatId: message.context.chatId,
      channel: message.channel,
    });

    try {
      const toolParts = await sessionManager.listToolParts(message.context.sessionKey);
      const outboundMessages = collectToolOutboundMessages({ toolParts, startedAt });
      for (const outbound of outboundMessages) {
        await router.sendToSession(outbound.sessionKey, outbound.content, {
          metadata: {
            toolOutbound: outbound,
          },
        });
      }

      const attachments = collectToolMediaAttachments({ toolParts, startedAt });
      for (const attachment of attachments) {
        await router.sendToSession(message.context.sessionKey, attachment.caption ?? "", {
          media: {
            type: attachment.mediaType ?? "file",
            data: attachment.path,
            filename: path.basename(attachment.path),
          },
          metadata: {
            toolMedia: attachment,
          },
        });
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err), sessionKey: message.context.sessionKey },
        "Failed to send tool media attachments"
      );
    }

    await router.sendToSession(message.context.sessionKey, result.response, {
      metadata: {
        providerId: result.providerId,
        model: result.model,
        runId: result.runId,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
      },
    });

    return {
      ...message,
      sender: { id: "agent", name: "Agent", isAgent: true },
      content: result.response,
      timestamp: Date.now(),
      metadata: {
        providerId: result.providerId,
        model: result.model,
        runId: result.runId,
      },
    };
  });

  return buildHarnessInstance({
    mode: "in_process",
    cfg,
    artifacts,
    getLogs: async (maxBytes) => readFileTail(cfg.resolved.logFilePath, maxBytes),
    injectInbound: async (message) => whatsapp.injectInbound(message),
    listOutbound: async (filter) => {
      const all = whatsapp.getOutbound();
      const filtered = all.filter((m) => {
        if (filter?.chatId && m.chatId !== filter.chatId) return false;
        if (filter?.sessionKey && m.sessionKey !== filter.sessionKey) return false;
        return true;
      });
      return filtered;
    },
    clearOutbound: async () => whatsapp.clearOutbound(),
    stop: async () => {
      await router.stop();
      await whatsapp.stop();
      await closeLogger();
      // SessionManager has no stop; files are already flushed.
    },
  });
}

// ============================================================================
// Child-process harness
// ============================================================================

async function startChildProcessHarness(
  cfg: AntConfig,
  artifacts: HarnessRunArtifacts,
  options: HarnessOptions
): Promise<HarnessInstance> {
  const launchTarget = options.launchTarget ?? "src";
  const env = buildChildEnv(options);

  const entry = resolveCliEntrypoint(launchTarget);
  const command = launchTarget === "src" ? entry : "node";
  const args =
    launchTarget === "src"
      ? [path.resolve(process.cwd(), "src/cli.ts"), "start", "-c", artifacts.configPath]
      : [entry, "start", "-c", artifacts.configPath];

  const proc = spawn(command, args, {
    cwd: cfg.resolved.workspaceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  proc.stdout?.on("data", (d: Buffer) => stdout.push(d.toString()));
  proc.stderr?.on("data", (d: Buffer) => stderr.push(d.toString()));

  const gatewayUrl = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
  artifacts.gatewayUrl = gatewayUrl;

  await waitForGateway(gatewayUrl, 30_000);

  const http = {
    get: (p: string) => fetch(`${gatewayUrl}${p}`, { signal: AbortSignal.timeout(10_000) }),
    post: (p: string, body: unknown) =>
      fetch(`${gatewayUrl}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }),
  };

  return buildHarnessInstance({
    mode: "child_process",
    cfg,
    artifacts,
    getLogs: async (maxBytes) => readFileTail(cfg.resolved.logFilePath, maxBytes),
    injectInbound: async (message) => {
      const res = await http.post("/api/test/whatsapp/inbound", message);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Inject inbound failed (${res.status}): ${text}\n${stderr.join("")}`);
      }
      return res.json() as any;
    },
    listOutbound: async (filter) => {
      const params = new URLSearchParams();
      if (filter?.chatId) params.set("chatId", filter.chatId);
      if (filter?.sessionKey) params.set("sessionKey", filter.sessionKey);
      const res = await http.get(`/api/test/whatsapp/outbound?${params.toString()}`);
      if (!res.ok) throw new Error(`List outbound failed (${res.status})`);
      const data = (await res.json()) as { ok: boolean; outbound: TestWhatsAppOutboundMessage[] };
      return data.outbound ?? [];
    },
    clearOutbound: async () => {
      const res = await http.post("/api/test/whatsapp/outbound/clear", {});
      if (!res.ok) throw new Error(`Clear outbound failed (${res.status})`);
    },
    stop: async () => {
      await stopChildProcess(proc);
      // Leave tempDir for caller to inspect; they can rm if desired.
      void stdout;
    },
  });
}

function buildHarnessInstance(params: {
  mode: HarnessMode;
  cfg: AntConfig;
  artifacts: HarnessRunArtifacts;
  getLogs: (maxBytes: number) => Promise<string>;
  injectInbound: (msg: TestWhatsAppInboundMessage) => Promise<{ accepted: boolean; sessionKey?: string; messageId?: string }>;
  listOutbound: (filter?: { chatId?: string; sessionKey?: string }) => Promise<TestWhatsAppOutboundMessage[]>;
  clearOutbound: () => Promise<void>;
  stop: () => Promise<void>;
}): HarnessInstance {
  const waitForWhatsAppOutbound = async (p: {
    chatId?: string;
    sessionKey?: string;
    timeoutMs?: number;
    contains?: string;
  }): Promise<TestWhatsAppOutboundMessage> => {
    const timeoutMs = p.timeoutMs ?? 60_000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const messages = await params.listOutbound({ chatId: p.chatId, sessionKey: p.sessionKey });
      const found = messages.find((m) => (p.contains ? m.content.includes(p.contains) : true));
      if (found) return found;
      await sleep(100);
    }

    throw new Error(`Timeout waiting for outbound message (${timeoutMs}ms)`);
  };

  return {
    mode: params.mode,
    cfg: params.cfg,
    artifacts: params.artifacts,

    sendWhatsAppText: params.injectInbound,
    listWhatsAppOutbound: params.listOutbound,
    clearWhatsAppOutbound: params.clearOutbound,
    waitForWhatsAppOutbound,

    readLogs: async (p) => params.getLogs(p?.maxBytes ?? 512_000),
    stop: params.stop,
  };
}

// ============================================================================
// Config writer
// ============================================================================

async function writeHarnessConfig(params: {
  baseConfigPath: string;
  outPath: string;
  runId: string;
  stateDir: string;
  gatewayPort: number;
  uiPort: number;
  options: HarnessOptions;
}): Promise<void> {
  const raw = JSON.parse(await fs.readFile(params.baseConfigPath, "utf-8")) as Record<string, any>;

  const workspaceDir = params.options.workspaceDir
    ? path.resolve(params.options.workspaceDir)
    : process.cwd();

  const next: Record<string, any> = {
    ...raw,
    workspaceDir,
    stateDir: params.stateDir,
    gateway: {
      ...(raw.gateway ?? {}),
      enabled: true,
      host: "127.0.0.1",
      port: params.gatewayPort,
    },
    ui: {
      ...(raw.ui ?? {}),
      host: "127.0.0.1",
      port: params.uiPort,
      enabled: false,
      autoOpen: false,
    },
    logging: {
      ...(raw.logging ?? {}),
      level: "debug",
      fileLevel: "trace",
      filePath: path.join(params.stateDir, "ant.log"),
    },
    whatsapp: {
      ...(raw.whatsapp ?? {}),
      sessionDir: path.join(params.stateDir, "whatsapp"),
    },
    memory: {
      ...(raw.memory ?? {}),
      enabled: params.options.enableMemory ?? false,
      indexSessions: params.options.enableMemory ?? false,
      sqlitePath: path.join(params.stateDir, "memory.sqlite"),
    },
    mainAgent: {
      ...(raw.mainAgent ?? {}),
      enabled: params.options.enableMainAgent ?? false,
    },
    scheduler: {
      ...(raw.scheduler ?? {}),
      enabled: params.options.enableScheduler ?? false,
      storePath: path.join(params.stateDir, "jobs.json"),
    },
    monitoring: {
      ...(raw.monitoring ?? {}),
      enabled: false,
    },
  };

  const openaiProviderId = Object.entries((raw.providers?.items ?? {}) as Record<string, any>)
    .find(([, provider]) => provider && provider.type === "openai")?.[0];

  if (openaiProviderId) {
    next.routing = {
      ...(next.routing ?? {}),
      parentForCli: openaiProviderId,
    };
  }

  await fs.writeFile(params.outPath, JSON.stringify(next, null, 2));
}

// ============================================================================
// Helpers
// ============================================================================

function applyHarnessEnv(options: HarnessOptions): void {
  if (options.blockExecDeletes ?? true) {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
  }
  process.env.ANT_DISABLE_PROVIDER_TOOLS =
    (process.env.ANT_DISABLE_PROVIDER_TOOLS || "").trim() || "1";
  process.env.ANT_ENABLE_TEST_API = "1";
  process.env.ANT_TEST_WHATSAPP_SELF_JID = options.testSelfJid || process.env.ANT_TEST_WHATSAPP_SELF_JID || "test-self@s.whatsapp.net";
}

function buildChildEnv(options: HarnessOptions): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.NODE_ENV = "test";
  env.ANT_ENABLE_TEST_API = "1";
  env.ANT_TEST_WHATSAPP_SELF_JID =
    options.testSelfJid || env.ANT_TEST_WHATSAPP_SELF_JID || "test-self@s.whatsapp.net";
  env.ANT_DISABLE_PROVIDER_TOOLS = (env.ANT_DISABLE_PROVIDER_TOOLS || "").trim() || "1";
  if (options.blockExecDeletes ?? true) {
    env.ANT_EXEC_BLOCK_DELETE = "1";
  }
  return env;
}

function resolveCliEntrypoint(target: HarnessLaunchTarget): string {
  if (target === "dist") {
    return path.resolve(process.cwd(), "dist/cli.js");
  }
  return path.resolve(process.cwd(), "node_modules/.bin/tsx");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGateway(baseUrl: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(100);
  }
  throw new Error(`Gateway failed to start (timeout ${timeoutMs}ms)`);
}

async function stopChildProcess(proc: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    if (proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }

    proc.kill("SIGTERM");
    const timeout = setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
    }, 10_000);

    proc.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const handle = await fs.open(filePath, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      await handle.read(buf, 0, buf.length, start);
      return buf.toString("utf-8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

async function findAvailablePort(startPort = 18000): Promise<number> {
  const net = await import("node:net");

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let port = startPort;

    const tryPort = () => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          port = port === 0 ? 0 : port + 1;
          if (startPort !== 0 && port > startPort + 200) {
            reject(new Error("Could not find available port"));
            return;
          }
          tryPort();
        } else {
          reject(err);
        }
      });

      server.once("listening", () => {
        const address = server.address();
        const resolvedPort =
          typeof address === "object" && address ? address.port : port;
        server.close(() => resolve(resolvedPort));
      });

      server.listen(port, "127.0.0.1");
    };

    tryPort();
  });
}

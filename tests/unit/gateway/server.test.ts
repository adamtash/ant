import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { GatewayServer } from "../../../src/gateway/server.js";
import { MessageRouter } from "../../../src/channels/router.js";
import { TestWhatsAppAdapter } from "../../../src/channels/whatsapp/test-adapter.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

async function findAvailablePort(startPort = 0): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(startPort, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : startPort;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout after ${timeoutMs}ms`);
}

function makeCfg(workspaceDir: string, stateDir: string) {
  return {
    workspaceDir,
    stateDir,
    providers: {
      default: "stub",
      items: {
        stub: { type: "openai", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "x", model: "stub" },
      },
      fallbackChain: [],
    },
    routing: { chat: "stub", tools: "stub", embeddings: "stub" },
    ui: { enabled: false, host: "127.0.0.1", port: 0, autoOpen: false, staticDir: "ui/dist" },
    gateway: { enabled: true, host: "127.0.0.1", port: 0 },
    whatsapp: {
      sessionDir: path.join(stateDir, "whatsapp"),
      respondToGroups: false,
      mentionOnly: false,
      respondToSelfOnly: true,
      allowSelfMessages: true,
      resetOnLogout: false,
      typingIndicator: false,
      mentionKeywords: [],
      ownerJids: [],
      startupRecipients: [],
    },
    memory: {
      enabled: false,
      indexSessions: false,
      sqlitePath: path.join(stateDir, "memory.sqlite"),
      embeddingsModel: "text-embedding-test",
      sync: { onSessionStart: false, onSearch: false, watch: false, intervalMinutes: 0 },
    },
    scheduler: { enabled: false, storePath: path.join(stateDir, "jobs.json"), timezone: "UTC" },
    monitoring: { enabled: false, retentionDays: 1, alertChannels: [], criticalErrorThreshold: 5 },
    logging: { level: "debug", fileLevel: "trace", filePath: path.join(stateDir, "ant.log") },
    resolved: {
      workspaceDir,
      stateDir,
      memorySqlitePath: path.join(stateDir, "memory.sqlite"),
      whatsappSessionDir: path.join(stateDir, "whatsapp"),
      providerEmbeddingsModel: "text-embedding-test",
      providers: { default: "stub", items: { stub: { type: "openai", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "x", model: "stub" } }, fallbackChain: [] },
      routing: { chat: "stub", tools: "stub", embeddings: "stub", summary: "stub", subagent: "stub", parentForCli: "stub" },
      logFilePath: path.join(stateDir, "ant.log"),
      logFileLevel: "trace",
      configPath: path.join(workspaceDir, "ant.config.json"),
      uiStaticDir: path.join(workspaceDir, "ui/dist"),
    },
  } as any;
}

describe("GatewayServer (in-process)", () => {
  let tempRoot: string;
  let workspaceDir: string;
  let stateDir: string;
  let port: number;
  let baseUrl: string;
  let router: MessageRouter;
  let server: GatewayServer;

  beforeAll(async () => {
    process.env.ANT_ENABLE_TEST_API = "1";

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-gateway-server-test-"));
    workspaceDir = path.join(tempRoot, "workspace");
    stateDir = path.join(tempRoot, ".ant");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(stateDir, { recursive: true });

    // Write a valid config file so /api/config can work if needed.
    const cfg = makeCfg(workspaceDir, stateDir);
    await fs.writeFile(cfg.resolved.configPath, JSON.stringify(cfg, null, 2));

    port = await findAvailablePort(0);
    baseUrl = `http://127.0.0.1:${port}`;

    router = new MessageRouter({
      logger: mockLogger as any,
      sessionOrdering: { enabled: true, maxConcurrentSessions: 3, queueTimeoutMs: 300_000 },
    });
    router.start();

    const whatsapp = new TestWhatsAppAdapter({
      cfg,
      logger: mockLogger as any,
      selfJid: "self@s.whatsapp.net",
    });
    await whatsapp.start();
    router.registerAdapter(whatsapp as any);

    // Simple echo handler so injected messages produce an outbound response
    router.setDefaultHandler(async (message) => {
      const responseText = `Echo: ${message.content}`;
      await router.sendToSession(message.context.sessionKey, responseText);
      return {
        ...message,
        sender: { id: "agent", name: "Agent", isAgent: true },
        content: responseText,
        timestamp: Date.now(),
        metadata: { providerId: "stub", model: "stub-model" },
      };
    });

    const agentEngine = {
      execute: async (input: any) => ({
        response: `Task: ${input.query}`,
        toolsUsed: [],
        iterations: 1,
        providerId: "stub",
        model: "stub-model",
      }),
    } as any;

    server = new GatewayServer({
      config: {
        port,
        host: "127.0.0.1",
        stateDir,
        logFilePath: path.join(stateDir, "ant.log"),
        configPath: cfg.resolved.configPath,
      },
      logger: mockLogger as any,
      agentEngine,
      router,
    });

    await server.start();
  }, 60000);

  afterAll(async () => {
    try {
      await server.stop();
    } catch {
      // ignore
    }
    try {
      await router.stop();
    } catch {
      // ignore
    }
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.ANT_ENABLE_TEST_API;
  });

  it("serves status and channels", async () => {
    const statusRes = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(5000) });
    expect(statusRes.ok).toBe(true);
    const status = await statusRes.json();
    expect(status.ok).toBe(true);

    const channelsRes = await fetch(`${baseUrl}/api/channels`, { signal: AbortSignal.timeout(5000) });
    expect(channelsRes.ok).toBe(true);
    const channels = await channelsRes.json();
    expect(channels.ok).toBe(true);
    const ids = (channels.channels as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain("whatsapp");
    expect(ids).toContain("web");
  });

  it("supports test WhatsApp inbound/outbound endpoints and persists sessions", async () => {
    await fetch(`${baseUrl}/api/test/whatsapp/outbound/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });

    const inboundRes = await fetch(`${baseUrl}/api/test/whatsapp/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: "self@s.whatsapp.net",
        text: "hello",
        senderId: "tester@s.whatsapp.net",
        pushName: "Tester",
      }),
      signal: AbortSignal.timeout(5000),
    });
    expect(inboundRes.ok).toBe(true);
    const inbound = await inboundRes.json();
    expect(inbound.ok).toBe(true);
    expect(inbound.accepted).toBe(true);

    await waitFor(async () => {
      const outRes = await fetch(`${baseUrl}/api/test/whatsapp/outbound?chatId=self@s.whatsapp.net`, {
        signal: AbortSignal.timeout(2000),
      });
      const data = await outRes.json();
      return Array.isArray(data.outbound) && data.outbound.length > 0;
    }, 5000);

    const outRes = await fetch(`${baseUrl}/api/test/whatsapp/outbound?chatId=self@s.whatsapp.net`, {
      signal: AbortSignal.timeout(5000),
    });
    const out = await outRes.json();
    expect(out.ok).toBe(true);
    expect(out.outbound[0].content).toContain("Echo: hello");

    // Session should be visible via /api/sessions after persistence hook creates it
    const sessionsRes = await fetch(`${baseUrl}/api/sessions?limit=50&offset=0`, {
      signal: AbortSignal.timeout(5000),
    });
    expect(sessionsRes.ok).toBe(true);
    const sessions = await sessionsRes.json();
    expect(sessions.ok).toBe(true);
    const keys = (sessions.sessions as Array<{ key: string }>).map((s) => s.key);
    expect(keys).toContain("whatsapp:dm:self@s.whatsapp.net");
  }, 30000);

  it("executes web tasks via /api/tasks", async () => {
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "do the thing" }),
      signal: AbortSignal.timeout(5000),
    });
    expect(create.ok).toBe(true);
    const created = await create.json();
    expect(created.status).toBe("queued");

    await waitFor(async () => {
      const get = await fetch(`${baseUrl}/api/tasks/${created.id}`, { signal: AbortSignal.timeout(2000) });
      const task = await get.json();
      return task.status === "completed";
    }, 5000);

    const get = await fetch(`${baseUrl}/api/tasks/${created.id}`, { signal: AbortSignal.timeout(5000) });
    const task = await get.json();
    expect(task.status).toBe("completed");
  }, 30000);
});


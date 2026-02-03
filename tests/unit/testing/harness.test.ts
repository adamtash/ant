import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { startHarness } from "../../../src/testing/harness.js";

async function startStubOpenAIServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";

    if (req.method === "GET" && url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      // Drain request body (not used for this stub)
      let body = "";
      req.on("data", (chunk) => (body += chunk.toString()));
      await new Promise((resolve) => req.on("end", resolve));

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: "assistant", content: "PONG" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("programmatic harness (in-process)", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-harness-test-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("injects a WhatsApp message and observes the outbound response", async () => {
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    const stub = await startStubOpenAIServer();
    try {
      const baseConfigPath = path.join(tempRoot, "base.config.json");
      await fs.writeFile(
        baseConfigPath,
        JSON.stringify(
          {
            workspaceDir,
            providers: {
              default: "stub",
              items: {
                stub: {
                  type: "openai",
                  baseUrl: stub.baseUrl,
                  apiKey: "not-needed",
                  model: "stub-model",
                },
              },
              fallbackChain: [],
            },
            routing: {
              chat: "stub",
              tools: "stub",
              embeddings: "stub",
            },
            ui: { enabled: false, host: "127.0.0.1", port: 0, autoOpen: false },
            gateway: { enabled: false, host: "127.0.0.1", port: 0 },
            whatsapp: {
              sessionDir: "./.ant/whatsapp",
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
              sqlitePath: "./.ant/memory.sqlite",
              embeddingsModel: "text-embedding-test",
              sync: { onSessionStart: false, onSearch: false, watch: false, intervalMinutes: 0 },
            },
            scheduler: { enabled: false, storePath: "./.ant/jobs.json", timezone: "UTC" },
            monitoring: { enabled: false, retentionDays: 1, alertChannels: [], criticalErrorThreshold: 5 },
            logging: { level: "debug", fileLevel: "trace", filePath: "./.ant/ant.log" },
          },
          null,
          2
        )
      );

      const h = await startHarness("in_process", {
        configPath: baseConfigPath,
        workspaceDir,
        testSelfJid: "self@s.whatsapp.net",
        blockExecDeletes: true,
        isolated: true,
      });

      try {
        await h.clearWhatsAppOutbound();

        const injected = await h.sendWhatsAppText({
          chatId: "self@s.whatsapp.net",
          text: "PING",
          senderId: "tester@s.whatsapp.net",
          pushName: "Tester",
          fromMe: false,
        });
        expect(injected.accepted).toBe(true);

        const outbound = await h.waitForWhatsAppOutbound({
          chatId: "self@s.whatsapp.net",
          timeoutMs: 15_000,
        });

        expect(outbound.content).toContain("PONG");
      } finally {
        await h.stop();
      }
    } finally {
      await stub.close();
    }
  }, 60000);
});


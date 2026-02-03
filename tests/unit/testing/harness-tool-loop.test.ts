import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { startHarness } from "../../../src/testing/harness.js";

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function startToolLoopOpenAIServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  getRequests: () => any[];
}> {
  let callCount = 0;
  const requests: any[] = [];

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";

    if (req.method === "GET" && url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      const body = await parseJsonBody(req);
      requests.push(body);
      callCount += 1;

      if (callCount === 1) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Writing file...",
                  tool_calls: [
                    {
                      id: "call-write",
                      function: {
                        name: "write",
                        arguments: JSON.stringify({ path: "foo.txt", content: "HELLO" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          })
        );
        return;
      }

      if (callCount === 2) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Sending file...",
                  tool_calls: [
                    {
                      id: "call-send",
                      function: {
                        name: "send_file",
                        arguments: JSON.stringify({ path: "foo.txt", type: "document", caption: "Here is the file" }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          })
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Done.",
              },
              finish_reason: "stop",
            },
          ],
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
    getRequests: () => [...requests],
  };
}

describe("harness tool loop (in-process)", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-harness-tool-loop-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("executes tool calls and persists tool results", async () => {
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    const stub = await startToolLoopOpenAIServer();
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
        isolated: true,
        blockExecDeletes: true,
      });

      try {
        await h.clearWhatsAppOutbound();

        const injected = await h.sendWhatsAppText({
          chatId: "self@s.whatsapp.net",
          text: "Run the tool loop",
          senderId: "tester@s.whatsapp.net",
          pushName: "Tester",
          fromMe: false,
        });
        expect(injected.accepted).toBe(true);

        const outbound = await h.waitForWhatsAppOutbound({
          chatId: "self@s.whatsapp.net",
          timeoutMs: 30_000,
          contains: "Done.",
        });

        expect(outbound.content).toContain("Done.");

        // Verify file was written by the tool
        const file = await fs.readFile(path.join(workspaceDir, "foo.txt"), "utf-8");
        expect(file).toBe("HELLO");

        // Verify a media message was sent via tool metadata
        const allOutbound = await h.listWhatsAppOutbound({ chatId: "self@s.whatsapp.net" });
        const media = allOutbound.find((m) => typeof m.media?.data === "string" && String(m.media?.data).endsWith("foo.txt"));
        expect(media).toBeDefined();
        expect(media?.content).toContain("Here is the file");

        // Verify tool messages were persisted to session log
        const sessionsDir = path.join(h.artifacts.stateDir, "sessions");
        const sessionFiles = (await fs.readdir(sessionsDir)).filter((f) => f.endsWith(".jsonl"));
        expect(sessionFiles.length).toBeGreaterThan(0);

        const content = await fs.readFile(path.join(sessionsDir, sessionFiles[0]!), "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const roles = lines.map((line) => {
          try {
            return JSON.parse(line).role;
          } catch {
            return null;
          }
        });
        expect(roles).toContain("tool");
      } finally {
        await h.stop();
      }

      // Validate that the stub server received multiple requests (tool loop)
      expect(stub.getRequests().length).toBeGreaterThanOrEqual(3);
    } finally {
      await stub.close();
    }
  }, 90000);
});

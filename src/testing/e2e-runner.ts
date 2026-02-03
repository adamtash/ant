import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { startHarness, type HarnessMode } from "./harness.js";
import type { TestWhatsAppInboundMessage, TestWhatsAppOutboundMessage } from "../channels/whatsapp/test-adapter.js";

export interface E2EScenario {
  id: string;
  description: string;
  inbound: Omit<TestWhatsAppInboundMessage, "chatId"> & { chatId?: string };
  wait?: {
    contains?: string;
    timeoutMs?: number;
  };
  expect?: {
    /** Whether inbound should be accepted by adapter filters (default true). */
    accepted?: boolean;
    /** Substring that must appear in at least one outbound message. */
    contains?: string;
    /** Minimum number of outbound messages expected (default: accepted ? 1 : 0). */
    outboundMin?: number;
    /** Minimum number of outbound messages with media expected (default 0). */
    mediaMin?: number;
  };
}

export interface E2EScenarioResult {
  id: string;
  description: string;
  ok: boolean;
  injected: { accepted: boolean; sessionKey?: string; messageId?: string };
  outboundFirst?: TestWhatsAppOutboundMessage;
  outboundAll: TestWhatsAppOutboundMessage[];
  persistence?: {
    ok: boolean;
    outboundContents: string[];
    sessionAssistantContents: string[];
    error?: string;
  };
  assertions?: {
    expectedAccepted: boolean;
    expectedContains?: string;
    expectedOutboundMin: number;
    expectedMediaMin: number;
    actualOutbound: number;
    actualMedia: number;
  };
  error?: string;
}

export interface E2ERunReport {
  ok: boolean;
  mode: HarnessMode;
  runId: string;
  workspaceDir: string;
  artifacts: {
    tempDir: string;
    stateDir: string;
    configPath: string;
    logFilePath: string;
    gatewayUrl?: string;
  };
  scenarios: E2EScenarioResult[];
  logs: {
    warnCount: number;
    errorCount: number;
    tail: string;
  };
  reportPath: string;
}

function parseMode(value: string | undefined): HarnessMode {
  const v = (value ?? "child_process").trim().toLowerCase();
  if (v === "in_process") return "in_process";
  if (v === "child_process") return "child_process";
  throw new Error(`Invalid mode: ${value} (expected in_process or child_process)`);
}

function summarizeLogTail(tail: string): { warnCount: number; errorCount: number } {
  const lines = tail.split("\n").filter(Boolean);
  let warnCount = 0;
  let errorCount = 0;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { level?: unknown };
      const level = typeof parsed.level === "number" ? parsed.level : undefined;
      if (level === 40) warnCount += 1;
      if (level === 50 || level === 60) errorCount += 1;
    } catch {
      // ignore
    }
  }

  return { warnCount, errorCount };
}

function safeSessionKey(sessionKey: string): string {
  return sessionKey
    .split(":")
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .join("_");
}

function inferWhatsAppSessionKey(chatId: string): string {
  const trimmed = chatId.trim();
  const isGroup = trimmed.endsWith("@g.us");
  return `whatsapp:${isGroup ? "group" : "dm"}:${trimmed}`;
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function waitForSessionAssistantMessages(params: {
  sessionFilePath: string;
  baselineLineCount: number;
  expectedOutboundContents: string[];
  timeoutMs: number;
}): Promise<{ ok: boolean; sessionAssistantContents: string[]; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < params.timeoutMs) {
    const lines = await readJsonlLines(params.sessionFilePath);
    const newLines = lines.slice(params.baselineLineCount);

    const assistantContents: string[] = [];
    for (const line of newLines) {
      try {
        const parsed = JSON.parse(line) as { role?: unknown; content?: unknown };
        if (parsed.role === "assistant") {
          assistantContents.push(typeof parsed.content === "string" ? parsed.content : String(parsed.content ?? ""));
        }
      } catch {
        // ignore invalid lines
      }
    }

    if (assistantContents.length < params.expectedOutboundContents.length) {
      await new Promise((r) => setTimeout(r, 50));
      continue;
    }

    if (assistantContents.length > params.expectedOutboundContents.length) {
      return {
        ok: false,
        sessionAssistantContents: assistantContents,
        error: `Session has ${assistantContents.length} assistant messages but expected ${params.expectedOutboundContents.length}`,
      };
    }

    const matches = assistantContents.every((v, i) => v === params.expectedOutboundContents[i]);
    return matches
      ? { ok: true, sessionAssistantContents: assistantContents }
      : {
          ok: false,
          sessionAssistantContents: assistantContents,
          error: "Session assistant message order/content does not match outbound order",
        };
  }

  return {
    ok: false,
    sessionAssistantContents: [],
    error: `Timeout waiting for session persistence (${params.timeoutMs}ms)`,
  };
}

export async function runE2E(params: {
  configPath: string;
  mode?: string;
  selfJid?: string;
  chatId?: string;
  timeoutMs?: number;
  workspaceDir?: string;
  enableMemory?: boolean;
  enableMainAgent?: boolean;
  enableScheduler?: boolean;
  launchTarget?: string;
  blockExecDeletes?: boolean;
  cleanup?: boolean;
  scenarios?: E2EScenario[];
}): Promise<E2ERunReport> {
  const mode = parseMode(params.mode);
  const timeoutMs = params.timeoutMs ?? 120_000;
  const selfJid = (params.selfJid ?? "").trim() || (process.env.ANT_TEST_WHATSAPP_SELF_JID ?? "").trim() || "test-self@s.whatsapp.net";
  const chatId = (params.chatId ?? "").trim() || selfJid;

  const workspaceDir = params.workspaceDir
    ? path.resolve(params.workspaceDir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "ant-e2e-workspace-"));

  const scenarios: E2EScenario[] = params.scenarios ?? [
    {
      id: "smoke_ok",
      description: "Basic response smoke test",
      inbound: { text: "Reply with exactly: OK", senderId: "e2e@s.whatsapp.net", pushName: "E2E", fromMe: false },
      wait: { contains: "OK", timeoutMs },
      expect: { contains: "OK" },
    },
    {
      id: "tool_file_roundtrip",
      description: "Tool loop: write/read file and echo token",
      inbound: {
        text: "Use the write tool to create e2e.txt with content E2E_OK. Then use the read tool to read it. Finally reply with exactly: FILE=E2E_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "FILE=E2E_OK", timeoutMs },
      expect: { contains: "FILE=E2E_OK" },
    },
    {
      id: "tool_list_files",
      description: "Tool loop: list should include e2e.txt",
      inbound: {
        text: "Use the list tool to list files in the workspace. Confirm that e2e.txt is present. Reply with exactly: LIST=1 if present, otherwise LIST=0",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "LIST=", timeoutMs },
      expect: { contains: "LIST=1" },
    },
    {
      id: "tool_write_append",
      description: "Tool loop: write + append should work",
      inbound: {
        text: "Use the write tool to create append.txt with content A. Then use write again with append=true to append B. Then use read to read append.txt. If the content is exactly AB, reply with exactly: APPEND_OK (otherwise APPEND_FAIL).",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "APPEND_", timeoutMs },
      expect: { contains: "APPEND_OK" },
    },
    {
      id: "tool_read_range",
      description: "Tool loop: read line ranges",
      inbound: {
        text: "Use the write tool to create lines.txt with content L1\\nL2\\nL3\\nL4. Then use the read tool with from=2 and lines=2. If the returned text is exactly L2\\nL3, reply with exactly: RANGE_OK (otherwise RANGE_FAIL).",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "RANGE_", timeoutMs },
      expect: { contains: "RANGE_OK" },
    },
    {
      id: "tool_ls_hidden",
      description: "Tool loop: ls hidden files",
      inbound: {
        text: "Use the write tool to create a hidden file named .hidden.txt with content X. Then use ls on the workspace without the all flag and confirm .hidden.txt is NOT listed. Then use ls with all=true and confirm .hidden.txt IS listed. Reply with exactly: HIDDEN_OK if both checks pass (otherwise HIDDEN_FAIL).",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "HIDDEN_", timeoutMs },
      expect: { contains: "HIDDEN_OK" },
    },
    {
      id: "tool_read_missing",
      description: "Tool error: reading missing file should be handled",
      inbound: {
        text: "Use the read tool to read missing-does-not-exist.txt. Then reply with exactly: READ_MISSING_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "READ_MISSING_OK", timeoutMs },
      expect: { contains: "READ_MISSING_OK" },
    },
    {
      id: "memory_update_search",
      description: "Memory tools: memory_update + memory_search should find the new note",
      inbound: {
        text: "Use the memory_update tool to save this note exactly: MEM_TOKEN_12345. Then use memory_search with query MEM_TOKEN_12345. If the result contains MEM_TOKEN_12345, reply with exactly: MEMORY_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "MEMORY_OK", timeoutMs },
      expect: { contains: "MEMORY_OK" },
    },
    {
      id: "exec_echo",
      description: "Exec tool: echo",
      inbound: {
        text: "Use the exec tool to run: echo EXEC_OK. Reply with exactly: EXEC=EXEC_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "EXEC=EXEC_OK", timeoutMs },
      expect: { contains: "EXEC=EXEC_OK" },
    },
    {
      id: "exec_args_array",
      description: "Exec tool: args array",
      inbound: {
        text: "Use the exec tool with command=echo and args=[\"ARGS_OK\"]. Then reply with exactly: ARGS=ARGS_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "ARGS=ARGS_OK", timeoutMs },
      expect: { contains: "ARGS=ARGS_OK" },
    },
    {
      id: "exec_timeout",
      description: "Exec tool: should respect timeout",
      inbound: {
        text: "Use the exec tool to run: sleep 5 with timeoutMs=1000. Then reply with exactly: EXEC_TIMEOUT_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "EXEC_TIMEOUT_OK", timeoutMs },
      expect: { contains: "EXEC_TIMEOUT_OK" },
    },
    {
      id: "exec_delete_block",
      description: "Exec tool: deletion blocked",
      inbound: {
        text: "Use the exec tool to run: rm -rf /tmp/ant_e2e_should_not_exist. Report whether it was blocked.",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { timeoutMs },
      expect: { outboundMin: 1 },
    },
    {
      id: "send_file",
      description: "Send file: write + send_file should produce outbound media",
      inbound: {
        text: "Use the write tool to create send_me.txt with content SEND_OK. Then use send_file to send it to me with caption CAPTION_OK. Then reply with exactly: SENT",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "SENT", timeoutMs },
      expect: { contains: "SENT", mediaMin: 1 },
    },
    {
      id: "send_file_missing",
      description: "Send file: missing path should return tool error (handled gracefully)",
      inbound: {
        text: "Use the send_file tool to send the file missing-send.txt (it does not exist). Then reply with exactly: SEND_MISSING_OK",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "SEND_MISSING_OK", timeoutMs },
      expect: { contains: "SEND_MISSING_OK" },
    },
    {
      id: "inbound_filtered_self_only",
      description: "WhatsApp adapter filter: respondToSelfOnly should reject other chat IDs",
      inbound: {
        chatId: "someone-else@s.whatsapp.net",
        text: "You should not accept this",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      expect: { accepted: false, outboundMin: 0 },
    },
    {
      id: "inbound_filtered_group",
      description: "WhatsApp adapter filter: respondToGroups=false should reject group chat IDs",
      inbound: {
        chatId: "12345-67890@g.us",
        text: "You should not accept group messages",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      expect: { accepted: false, outboundMin: 0 },
    },
    {
      id: "message_send_tool",
      description: "Tool: message_send should actually deliver an extra message",
      inbound: {
        text: "Use the message_send tool to send the text TOOL_PING to chatId test-self@s.whatsapp.net. Then reply with exactly: MSG_TOOL_DONE",
        senderId: "e2e@s.whatsapp.net",
        pushName: "E2E",
        fromMe: false,
      },
      wait: { contains: "MSG_TOOL_DONE", timeoutMs },
      expect: { contains: "MSG_TOOL_DONE", outboundMin: 2 },
    },
  ];

  const harness = await startHarness(mode, {
    configPath: params.configPath,
    workspaceDir,
    testSelfJid: selfJid,
    blockExecDeletes: params.blockExecDeletes ?? true,
    isolated: true,
    enableMemory: params.enableMemory ?? false,
    enableMainAgent: params.enableMainAgent ?? false,
    enableScheduler: params.enableScheduler ?? false,
    launchTarget: params.launchTarget === "dist" ? "dist" : "src",
  });

  const results: E2EScenarioResult[] = [];
  try {
    for (const scenario of scenarios) {
      await harness.clearWhatsAppOutbound();

      const effectiveChatId = scenario.inbound.chatId ?? chatId;
      const expectedSessionKey = inferWhatsAppSessionKey(effectiveChatId);
      const sessionFilePath = path.join(harness.artifacts.stateDir, "sessions", `${safeSessionKey(expectedSessionKey)}.jsonl`);
      const baselineLineCount = (await readJsonlLines(sessionFilePath)).length;

      const injected = await harness.sendWhatsAppText({
        chatId: effectiveChatId,
        text: scenario.inbound.text,
        senderId: scenario.inbound.senderId,
        pushName: scenario.inbound.pushName,
        fromMe: scenario.inbound.fromMe,
        mentions: scenario.inbound.mentions,
        timestampMs: scenario.inbound.timestampMs,
      });

      const expectedAccepted = scenario.expect?.accepted ?? true;
      const expectedOutboundMin = scenario.expect?.outboundMin ?? (expectedAccepted ? 1 : 0);
      const expectedMediaMin = scenario.expect?.mediaMin ?? 0;
      const expectedContains = scenario.expect?.contains ?? scenario.wait?.contains;

      if (!injected.accepted) {
        const ok = expectedAccepted === false;
        results.push({
          id: scenario.id,
          description: scenario.description,
          ok,
          injected,
          outboundAll: [],
          assertions: {
            expectedAccepted,
            expectedContains,
            expectedOutboundMin,
            expectedMediaMin,
            actualOutbound: 0,
            actualMedia: 0,
          },
          error: ok ? undefined : "Inbound message filtered by adapter",
        });
        continue;
      }

      if (expectedAccepted === false) {
        const outboundAll = await harness.listWhatsAppOutbound({ chatId: effectiveChatId });
        const mediaCount = outboundAll.filter((m) => Boolean(m.media)).length;
        results.push({
          id: scenario.id,
          description: scenario.description,
          ok: false,
          injected,
          outboundAll,
          assertions: {
            expectedAccepted,
            expectedContains,
            expectedOutboundMin,
            expectedMediaMin,
            actualOutbound: outboundAll.length,
            actualMedia: mediaCount,
          },
          error: "Inbound message was accepted but expected to be filtered",
        });
        continue;
      }

      try {
        const shouldWait = expectedOutboundMin > 0 || Boolean(expectedContains);
        const outboundFirst = shouldWait
          ? await harness.waitForWhatsAppOutbound({
              chatId: effectiveChatId,
              timeoutMs: scenario.wait?.timeoutMs ?? timeoutMs,
              contains: expectedContains,
            })
          : undefined;

        const outboundAll = await harness.listWhatsAppOutbound({ chatId: effectiveChatId });

        const mediaCount = outboundAll.filter((m) => Boolean(m.media)).length;
        const hasExpectedSubstring = expectedContains
          ? outboundAll.some((m) => m.content.includes(expectedContains))
          : true;

        const outboundContents = outboundAll.map((m) => m.content);
        const persistence = outboundContents.length > 0
          ? await waitForSessionAssistantMessages({
              sessionFilePath,
              baselineLineCount,
              expectedOutboundContents: outboundContents,
              timeoutMs: Math.min(15_000, scenario.wait?.timeoutMs ?? timeoutMs),
            })
          : { ok: true, sessionAssistantContents: [] as string[] };
        const ok =
          outboundAll.length >= expectedOutboundMin &&
          mediaCount >= expectedMediaMin &&
          hasExpectedSubstring &&
          persistence.ok;

        results.push({
          id: scenario.id,
          description: scenario.description,
          ok,
          injected,
          outboundFirst,
          outboundAll,
          persistence: {
            ok: persistence.ok,
            outboundContents,
            sessionAssistantContents: persistence.sessionAssistantContents,
            error: persistence.ok ? undefined : persistence.error,
          },
          assertions: {
            expectedAccepted,
            expectedContains,
            expectedOutboundMin,
            expectedMediaMin,
            actualOutbound: outboundAll.length,
            actualMedia: mediaCount,
          },
        });
      } catch (err) {
        const outboundAll = await harness.listWhatsAppOutbound({ chatId: effectiveChatId });
        const mediaCount = outboundAll.filter((m) => Boolean(m.media)).length;
        results.push({
          id: scenario.id,
          description: scenario.description,
          ok: false,
          injected,
          outboundAll,
          assertions: {
            expectedAccepted,
            expectedContains,
            expectedOutboundMin,
            expectedMediaMin,
            actualOutbound: outboundAll.length,
            actualMedia: mediaCount,
          },
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const tail = await harness.readLogs({ maxBytes: 512_000 });
    const summary = summarizeLogTail(tail);

    const report: E2ERunReport = {
      ok: results.every((r) => r.ok),
      mode: harness.mode,
      runId: harness.artifacts.runId,
      workspaceDir,
      artifacts: {
        tempDir: harness.artifacts.tempDir,
        stateDir: harness.artifacts.stateDir,
        configPath: harness.artifacts.configPath,
        logFilePath: harness.artifacts.logFilePath,
        gatewayUrl: harness.artifacts.gatewayUrl,
      },
      scenarios: results,
      logs: {
        warnCount: summary.warnCount,
        errorCount: summary.errorCount,
        tail,
      },
      reportPath: path.join(harness.artifacts.tempDir, "e2e-report.json"),
    };

    await fs.writeFile(report.reportPath, JSON.stringify(report, null, 2));
    return report;
  } finally {
    await harness.stop();

    if (params.cleanup) {
      try {
        await fs.rm(harness.artifacts.tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

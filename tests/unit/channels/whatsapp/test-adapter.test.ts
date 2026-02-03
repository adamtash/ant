import { describe, it, expect, vi, beforeEach } from "vitest";
import { TestWhatsAppAdapter } from "../../../../src/channels/whatsapp/test-adapter.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function makeCfg(overrides: Partial<any> = {}) {
  return {
    whatsapp: {
      sessionDir: "./.ant/whatsapp",
      respondToGroups: false,
      mentionOnly: true,
      botName: "ant",
      respondToSelfOnly: true,
      allowSelfMessages: true,
      resetOnLogout: false,
      typingIndicator: false,
      mentionKeywords: ["ant"],
      ownerJids: [],
      startupRecipients: [],
    },
    memory: {
      enabled: false,
      indexSessions: false,
      sqlitePath: "./.ant/memory.sqlite",
      embeddingsModel: "text-embedding-test",
    },
    resolved: {
      workspaceDir: "/tmp",
      stateDir: "/tmp/.ant",
      memorySqlitePath: "/tmp/.ant/memory.sqlite",
      whatsappSessionDir: "/tmp/.ant/whatsapp",
      providerEmbeddingsModel: "text-embedding-test",
      providers: { default: "test", items: {}, fallbackChain: [] },
      routing: { chat: "test", tools: "test", embeddings: "test", summary: "test", subagent: "test", parentForCli: "test" },
      logFilePath: "/tmp/.ant/ant.log",
      logFileLevel: "trace",
      configPath: "/tmp/ant.config.json",
      uiStaticDir: "/tmp/ui/dist",
    },
    ...overrides,
  } as any;
}

describe("TestWhatsAppAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters messages when respondToSelfOnly is true and chatId is not self", async () => {
    const cfg = makeCfg({ whatsapp: { respondToSelfOnly: true, mentionOnly: false, ownerJids: [] } });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    const result = adapter.injectInbound({
      chatId: "someone-else@s.whatsapp.net",
      text: "hello",
      senderId: "tester@s.whatsapp.net",
      fromMe: false,
    });

    expect(result.accepted).toBe(false);
  });

  it("accepts messages when respondToSelfOnly is true and chatId matches self", async () => {
    const cfg = makeCfg({ whatsapp: { respondToSelfOnly: true, mentionOnly: false, ownerJids: [] } });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    const received: any[] = [];
    adapter.on("message", (evt: any) => received.push(evt));

    const result = adapter.injectInbound({
      chatId: "self@s.whatsapp.net",
      text: "hello",
      senderId: "tester@s.whatsapp.net",
      fromMe: false,
    });

    expect(result.accepted).toBe(true);
    expect(result.sessionKey).toBe("whatsapp:dm:self@s.whatsapp.net");
    expect(received.length).toBe(1);
    expect(received[0].message.content).toBe("hello");
  });

  it("filters group messages when respondToGroups is false", async () => {
    const cfg = makeCfg({
      whatsapp: { respondToGroups: false, respondToSelfOnly: false, mentionOnly: false, ownerJids: [] },
    });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    const result = adapter.injectInbound({
      chatId: "test-group@g.us",
      text: "hello group",
      senderId: "tester@s.whatsapp.net",
      fromMe: false,
    });

    expect(result.accepted).toBe(false);
  });

  it("requires mention for groups when mentionOnly is true", async () => {
    const cfg = makeCfg({
      whatsapp: { respondToGroups: true, respondToSelfOnly: false, mentionOnly: true, mentionKeywords: [], ownerJids: [] },
    });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    const withoutMention = adapter.injectInbound({
      chatId: "test-group@g.us",
      text: "hello group",
      senderId: "tester@s.whatsapp.net",
      fromMe: false,
      mentions: [],
    });
    expect(withoutMention.accepted).toBe(false);

    const withMention = adapter.injectInbound({
      chatId: "test-group@g.us",
      text: "hello @self",
      senderId: "tester@s.whatsapp.net",
      fromMe: false,
      mentions: ["self@s.whatsapp.net"],
    });
    expect(withMention.accepted).toBe(true);
  });

  it("enforces owner allowlist when ownerJids is set", async () => {
    const cfg = makeCfg({
      whatsapp: {
        respondToGroups: false,
        respondToSelfOnly: false,
        mentionOnly: false,
        ownerJids: ["owner@s.whatsapp.net"],
      },
    });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    const notOwner = adapter.injectInbound({
      chatId: "someone@s.whatsapp.net",
      text: "hello",
      senderId: "not-owner@s.whatsapp.net",
      fromMe: false,
    });
    expect(notOwner.accepted).toBe(false);

    const owner = adapter.injectInbound({
      chatId: "someone@s.whatsapp.net",
      text: "hello",
      senderId: "owner@s.whatsapp.net",
      fromMe: false,
    });
    expect(owner.accepted).toBe(true);
  });

  it("records outbound messages and typing events", async () => {
    const cfg = makeCfg({ whatsapp: { respondToSelfOnly: false, mentionOnly: false, ownerJids: [] } });
    const adapter = new TestWhatsAppAdapter({ cfg, logger: mockLogger as any, selfJid: "self@s.whatsapp.net" });
    await adapter.start();

    await adapter.sendTyping("chat@s.whatsapp.net", true);
    await adapter.sendText("chat@s.whatsapp.net", "hi");
    await adapter.sendTyping("chat@s.whatsapp.net", false);

    const outbound = adapter.getOutbound();
    expect(outbound.length).toBe(1);
    expect(outbound[0].chatId).toBe("chat@s.whatsapp.net");
    expect(outbound[0].content).toBe("hi");

    const typing = adapter.getTypingEvents();
    expect(typing.length).toBe(2);
    expect(typing[0].isTyping).toBe(true);
    expect(typing[1].isTyping).toBe(false);
  });
});


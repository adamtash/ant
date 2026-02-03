import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentEngine, type AgentEngineConfig } from "../../../src/agent/engine.js";
import type { AgentConfig, AgentInput } from "../../../src/agent/types.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

const mockToolRegistry = {
  getDefinitions: vi.fn(() => []),
  getDefinitionsForPolicy: vi.fn(() => []),
  get: vi.fn(() => ({ meta: { timeoutMs: 5000 } })),
  execute: vi.fn(),
  initialize: vi.fn(),
} as any;

function makeProvider(params: {
  id: string;
  type: "cli" | "openai";
  model: string;
  chat: ReturnType<typeof vi.fn>;
}) {
  return {
    id: params.id,
    type: params.type,
    model: params.model,
    name: params.id,
    chat: params.chat,
    health: vi.fn(async () => true),
    estimateCost: vi.fn(() => 0),
  } as any;
}

function makeProviderManager(providers: Record<string, any>, routing: Record<string, string>) {
  const selectBestProvider = vi.fn(async (action: string) => {
    const id = routing[action] || routing.chat;
    const provider = providers[id];
    if (!provider) throw new Error(`No provider for action ${action}`);
    return provider;
  });

  const getProviderById = vi.fn((id: string) => providers[id]);
  const getPrioritizedProviderIds = vi.fn((primary: string) => [primary]);

  return {
    selectBestProvider,
    getProviderById,
    getPrioritizedProviderIds,
    getProviderIds: vi.fn(() => Object.keys(providers)),
    getProvider: vi.fn(() => providers[routing.chat]),
    isProviderCoolingDown: vi.fn(() => false),
    recordProviderFailure: vi.fn(() => ({
      opened: true,
      attempt: 1,
      cooldownMs: 2000,
      cooldownUntil: Date.now() + 2000,
      reason: "unknown",
    })),
    recordProviderSuccess: vi.fn(() => ({ recovered: false })),
    initialize: vi.fn(),
  } as any;
}

describe("AgentEngine multi-provider behavior", () => {
  const savedDisableProviderTools = process.env.ANT_DISABLE_PROVIDER_TOOLS;
  const savedExecBlockDelete = process.env.ANT_EXEC_BLOCK_DELETE;

  beforeEach(() => {
    vi.clearAllMocks();
    if (savedDisableProviderTools === undefined) {
      delete process.env.ANT_DISABLE_PROVIDER_TOOLS;
    } else {
      process.env.ANT_DISABLE_PROVIDER_TOOLS = savedDisableProviderTools;
    }
    if (savedExecBlockDelete === undefined) {
      delete process.env.ANT_EXEC_BLOCK_DELETE;
    } else {
      process.env.ANT_EXEC_BLOCK_DELETE = savedExecBlockDelete;
    }
  });

  afterEach(() => {
    if (savedDisableProviderTools === undefined) {
      delete process.env.ANT_DISABLE_PROVIDER_TOOLS;
    } else {
      process.env.ANT_DISABLE_PROVIDER_TOOLS = savedDisableProviderTools;
    }
    if (savedExecBlockDelete === undefined) {
      delete process.env.ANT_EXEC_BLOCK_DELETE;
    } else {
      process.env.ANT_EXEC_BLOCK_DELETE = savedExecBlockDelete;
    }
  });

  const baseConfig: AgentConfig = {
    maxToolIterations: 2,
    maxHistoryTokens: 8000,
    temperature: 0.2,
  };

  function createEngine(providerManager: any): AgentEngine {
    const cfg: AgentEngineConfig = {
      config: baseConfig,
      logger: mockLogger as any,
      providerManager,
      toolRegistry: mockToolRegistry,
      workspaceDir: "/tmp/test-workspace",
      stateDir: "/tmp/test-state",
    };
    return new AgentEngine(cfg);
  }

  it("runs tool loop with parentForCli and skips CLI finalization when provider tools disabled", async () => {
    process.env.ANT_DISABLE_PROVIDER_TOOLS = "1";

    const chatCli = makeProvider({
      id: "chat-cli",
      type: "cli",
      model: "cli-model",
      chat: vi.fn(async () => ({ content: "FINAL (cli)", toolCalls: [], finishReason: "stop" })),
    });

    const parentOpenai = makeProvider({
      id: "parent-openai",
      type: "openai",
      model: "openai-model",
      chat: vi.fn(async () => ({ content: "TOOL RUNNER ANSWER", toolCalls: [], finishReason: "stop" })),
    });

    const providers = {
      [chatCli.id]: chatCli,
      [parentOpenai.id]: parentOpenai,
    };

    const pm = makeProviderManager(providers, {
      chat: chatCli.id,
      parentForCli: parentOpenai.id,
      tools: parentOpenai.id,
    });

    const engine = createEngine(pm);

    const input: AgentInput = {
      sessionKey: "s1",
      query: "Hello",
      channel: "cli",
      chatId: "chat1",
    };

    const result = await engine.execute(input);

    expect(pm.selectBestProvider).toHaveBeenCalledWith("chat");
    expect(pm.selectBestProvider).toHaveBeenCalledWith("parentForCli");
    expect(parentOpenai.chat).toHaveBeenCalledTimes(1);
    expect(chatCli.chat).toHaveBeenCalledTimes(0);
    expect(result.response).toBe("TOOL RUNNER ANSWER");
    expect(result.providerId).toBe(parentOpenai.id);
  });

  it("finalizes with CLI chat provider when provider tools are enabled", async () => {
    delete process.env.ANT_DISABLE_PROVIDER_TOOLS;
    delete process.env.ANT_EXEC_BLOCK_DELETE;

    const chatCli = makeProvider({
      id: "chat-cli",
      type: "cli",
      model: "cli-model",
      chat: vi.fn(async () => ({ content: "FINAL ANSWER", toolCalls: [], finishReason: "stop" })),
    });

    const parentOpenai = makeProvider({
      id: "parent-openai",
      type: "openai",
      model: "openai-model",
      chat: vi.fn(async () => ({ content: "TOOL RUNNER ANSWER", toolCalls: [], finishReason: "stop" })),
    });

    const providers = {
      [chatCli.id]: chatCli,
      [parentOpenai.id]: parentOpenai,
    };

    const pm = makeProviderManager(providers, {
      chat: chatCli.id,
      parentForCli: parentOpenai.id,
      tools: parentOpenai.id,
    });

    const engine = createEngine(pm);

    const input: AgentInput = {
      sessionKey: "s2",
      query: "Hello",
      channel: "cli",
      chatId: "chat2",
    };

    const result = await engine.execute(input);

    expect(parentOpenai.chat).toHaveBeenCalledTimes(1);
    expect(chatCli.chat).toHaveBeenCalledTimes(1);
    expect(result.response).toBe("FINAL ANSWER");
    expect(result.providerId).toBe(chatCli.id);
  });
});

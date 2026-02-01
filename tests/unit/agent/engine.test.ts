import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentEngine, type AgentEngineConfig } from "../../../src/agent/engine.js";
import { ToolRegistry } from "../../../src/agent/tool-registry.js";
import { ProviderManager } from "../../../src/agent/providers.js";
import type { AgentConfig, AgentInput, Message } from "../../../src/agent/types.js";

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

// Mock tool registry
const mockToolRegistry = {
  getDefinitions: vi.fn(() => []),
  execute: vi.fn(),
  initialize: vi.fn(),
} as unknown as ToolRegistry;

// Mock provider
const mockProvider = {
  chat: vi.fn(),
  getName: vi.fn(() => "test-provider"),
  getModel: vi.fn(() => "test-model"),
};

// Mock provider manager
const mockProviderManager = {
  selectBestProvider: vi.fn(() => mockProvider),
  initialize: vi.fn(),
} as unknown as ProviderManager;

describe("AgentEngine", () => {
  let engine: AgentEngine;

  const defaultConfig: AgentConfig = {
    name: "test-agent",
    maxToolIterations: 3,
    maxHistoryTokens: 4000,
    temperature: 0.7,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const engineConfig: AgentEngineConfig = {
      config: defaultConfig,
      logger: mockLogger as any,
      providerManager: mockProviderManager,
      toolRegistry: mockToolRegistry,
      workspaceDir: "/tmp/test-workspace",
      stateDir: "/tmp/test-state",
    };

    engine = new AgentEngine(engineConfig);
  });

  describe("constructor", () => {
    it("should create an AgentEngine instance", () => {
      expect(engine).toBeInstanceOf(AgentEngine);
    });

    it("should expose tool registry", () => {
      expect(engine.getToolRegistry()).toBe(mockToolRegistry);
    });

    it("should expose provider manager", () => {
      expect(engine.getProviderManager()).toBe(mockProviderManager);
    });
  });

  describe("execute", () => {
    it("should return response when no tool calls", async () => {
      mockProvider.chat.mockResolvedValue({
        content: "Hello! I can help you with that.",
        toolCalls: [],
      });

      const input: AgentInput = {
        sessionKey: "test-session",
        query: "Say hello",
        chatId: "test-chat",
      };

      const result = await engine.execute(input);

      expect(result.response).toBe("Hello! I can help you with that.");
      expect(result.toolsUsed).toEqual([]);
      expect(result.iterations).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it("should execute tools when provider returns tool calls", async () => {
      // First call returns tool call, second call returns final response
      mockProvider.chat
        .mockResolvedValueOnce({
          content: "Let me check that for you.",
          toolCalls: [
            {
              id: "call-1",
              name: "test-tool",
              arguments: { arg1: "value1" },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: "Based on the result, here is your answer.",
          toolCalls: [],
        });

      mockToolRegistry.execute = vi.fn().mockResolvedValue({
        ok: true,
        data: { result: "tool output" },
      });

      const input: AgentInput = {
        sessionKey: "test-session",
        query: "Run a tool",
        chatId: "test-chat",
      };

      const result = await engine.execute(input);

      expect(result.toolsUsed).toContain("test-tool");
      expect(result.iterations).toBe(2);
      expect(mockToolRegistry.execute).toHaveBeenCalledWith(
        "test-tool",
        { arg1: "value1" },
        expect.any(Object)
      );
    });

    it("should handle errors gracefully", async () => {
      mockProvider.chat.mockRejectedValue(new Error("Provider error"));

      const input: AgentInput = {
        sessionKey: "test-session",
        query: "Cause an error",
        chatId: "test-chat",
      };

      const result = await engine.execute(input);

      expect(result.error).toBe("Provider error");
      expect(result.response).toContain("I encountered an error");
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it("should respect max iterations", async () => {
      // Always return tool calls to trigger max iterations
      mockProvider.chat.mockResolvedValue({
        content: "Calling tool...",
        toolCalls: [
          {
            id: "call-loop",
            name: "endless-tool",
            arguments: {},
          },
        ],
      });

      mockToolRegistry.execute = vi.fn().mockResolvedValue({
        ok: true,
        data: {},
      });

      const input: AgentInput = {
        sessionKey: "test-session",
        query: "Loop forever",
        chatId: "test-chat",
      };

      const result = await engine.execute(input);

      expect(result.iterations).toBe(defaultConfig.maxToolIterations);
      expect(result.error).toBe("Max iterations reached");
    });
  });

  describe("stripReasoning", () => {
    it("should strip reasoning tags from response", async () => {
      mockProvider.chat.mockResolvedValue({
        content: "<think>This is my reasoning</think>Here is the answer",
        toolCalls: [],
      });

      const input: AgentInput = {
        sessionKey: "test-session",
        query: "Think about something",
        chatId: "test-chat",
      };

      const result = await engine.execute(input);

      expect(result.response).toBe("Here is the answer");
    });
  });
});

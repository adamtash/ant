/**
 * Agent Engine - Core execution engine for the ANT agent
 *
 * Features:
 * - Unified tool loop with max iterations
 * - Provider routing and fallback
 * - Memory context integration
 * - Error recovery and retry logic
 * - Subagent spawning support
 */

import type {
  AgentInput,
  AgentOutput,
  Message,
  ToolCall,
  ToolContext,
  ToolResult,
  AgentConfig,
  CronContext,
} from "./types.js";
import type { Logger } from "../log.js";
import { ToolRegistry } from "./tool-registry.js";
import { ProviderManager, withRetry } from "./providers.js";
import {
  buildSystemPrompt,
  loadBootstrapFiles,
  trimMessagesForContext,
  type RuntimeInfo,
  type MemoryContext,
} from "./prompt-builder.js";

/**
 * Agent Engine configuration
 */
export interface AgentEngineConfig {
  config: AgentConfig;
  logger: Logger;
  providerManager: ProviderManager;
  toolRegistry: ToolRegistry;
  workspaceDir: string;
  stateDir: string;
  memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;
}

/**
 * Agent Engine - Main execution class
 */
export class AgentEngine {
  private readonly config: AgentConfig;
  private readonly logger: Logger;
  private readonly providers: ProviderManager;
  private readonly tools: ToolRegistry;
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;

  constructor(params: AgentEngineConfig) {
    this.config = params.config;
    this.logger = params.logger;
    this.providers = params.providerManager;
    this.tools = params.toolRegistry;
    this.workspaceDir = params.workspaceDir;
    this.stateDir = params.stateDir;
    this.memorySearch = params.memorySearch;
  }

  /**
   * Execute an agent task
   */
  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    let iterations = 0;

    try {
      this.logger.info({ sessionKey: input.sessionKey, query: input.query.slice(0, 100) }, "Agent execution started");

      // 1. Build enhanced prompt with context
      const systemPrompt = await this.buildPrompt(input);

      // 2. Build initial messages
      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        ...(input.history || []),
        { role: "user", content: input.query },
      ];

      // 3. Trim messages to fit context window
      const trimmedMessages = trimMessagesForContext(
        messages,
        this.config.maxHistoryTokens
      );

      // 4. Get provider and tool definitions
      const provider = await this.providers.selectBestProvider();
      const toolDefs = this.tools.getDefinitions();

      // 5. Execute tool loop
      let currentMessages: Message[] = [...trimmedMessages];
      const maxIterations = this.config.maxToolIterations || 6;

      while (iterations < maxIterations) {
        iterations++;

        this.logger.debug({ iteration: iterations }, "Tool loop iteration");

        // Call LLM with retry
        const response = await withRetry(() =>
          provider.chat(currentMessages, {
            temperature: this.config.temperature,
            tools: toolDefs,
            toolChoice: "auto",
          })
        );

        // Check if we have tool calls
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // No more tool calls, we're done
          const finalResponse = this.stripReasoning(response.content);

          this.logger.info(
            { iterations, toolsUsed, duration: Date.now() - startTime },
            "Agent execution complete"
          );

          return {
            response: finalResponse,
            toolsUsed,
            iterations,
          };
        }

        // Add assistant message with tool calls
        currentMessages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Execute tools
        for (const toolCall of response.toolCalls) {
          toolsUsed.push(toolCall.name);

          const toolContext = this.createToolContext(input);
          const result = await this.executeToolWithRecovery(toolCall, toolContext);

          // Add tool result to messages
          currentMessages.push({
            role: "tool",
            content: this.formatToolResult(result),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });
        }
      }

      // Max iterations reached
      this.logger.warn({ iterations }, "Max tool iterations reached");

      return {
        response: "I've reached the maximum number of tool iterations. Here's what I've done so far.",
        toolsUsed,
        iterations,
        error: "Max iterations reached",
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ error, duration: Date.now() - startTime }, "Agent execution failed");

      return {
        response: `I encountered an error: ${error}`,
        toolsUsed,
        iterations,
        error,
      };
    }
  }

  /**
   * Build the system prompt with all context
   */
  private async buildPrompt(input: AgentInput): Promise<string> {
    // Load bootstrap files
    const bootstrapFiles = await loadBootstrapFiles({
      workspaceDir: this.workspaceDir,
      isSubagent: input.isSubagent,
    });

    // Get memory context if available
    let memoryContext: MemoryContext | undefined;
    if (this.memorySearch) {
      try {
        const results = await this.memorySearch(input.query, 5);
        if (results.length > 0) {
          memoryContext = {
            recentMemory: [],
            relevantContext: results,
          };
        }
      } catch (err) {
        this.logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Memory search failed");
      }
    }

    // Build runtime info
    const runtimeInfo: RuntimeInfo = {
      model: "unknown", // Will be filled by provider
      providerType: "openai",
      workspaceDir: this.workspaceDir,
      currentTime: new Date(),
      cronContext: input.cronContext,
    };

    return buildSystemPrompt({
      config: this.config,
      tools: this.tools.getDefinitions(),
      bootstrapFiles,
      runtimeInfo,
      memoryContext,
      isSubagent: input.isSubagent,
    });
  }

  /**
   * Create tool context for execution
   */
  private createToolContext(input: AgentInput): ToolContext {
    return {
      workspaceDir: this.workspaceDir,
      stateDir: this.stateDir,
      sessionKey: input.sessionKey,
      chatId: input.chatId,
      logger: this.logger.child({ component: "tool" }),
      config: this.config,
    };
  }

  /**
   * Execute a tool with error recovery
   */
  private async executeToolWithRecovery(
    toolCall: ToolCall,
    ctx: ToolContext
  ): Promise<ToolResult> {
    this.logger.debug({ tool: toolCall.name, args: toolCall.arguments }, "Executing tool");

    try {
      const result = await this.tools.execute(
        toolCall.name,
        toolCall.arguments,
        ctx
      );

      this.logger.debug(
        { tool: toolCall.name, ok: result.ok, duration: result.metadata?.duration },
        "Tool execution complete"
      );

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ tool: toolCall.name, error }, "Tool execution failed");

      return {
        ok: false,
        error,
        metadata: {
          recovered: false,
        },
      };
    }
  }

  /**
   * Format tool result for message
   */
  private formatToolResult(result: ToolResult): string {
    if (result.ok) {
      return JSON.stringify({ ok: true, data: result.data });
    } else {
      return JSON.stringify({ ok: false, error: result.error });
    }
  }

  /**
   * Strip reasoning tags from response
   */
  private stripReasoning(text: string): string {
    if (!text) return text;
    const endTag = "</think>";
    const idx = text.lastIndexOf(endTag);
    if (idx !== -1) {
      return text.slice(idx + endTag.length).trim();
    }
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  /**
   * Get tool registry (for external access)
   */
  getToolRegistry(): ToolRegistry {
    return this.tools;
  }

  /**
   * Get provider manager (for external access)
   */
  getProviderManager(): ProviderManager {
    return this.providers;
  }
}

/**
 * Create and initialize an agent engine
 */
export async function createAgentEngine(params: {
  config: AgentConfig;
  providerConfig: {
    providers: Record<string, {
      type: "openai" | "cli" | "ollama";
      cliProvider?: "copilot" | "claude" | "codex";
      baseUrl?: string;
      apiKey?: string;
      model: string;
    }>;
    defaultProvider: string;
  };
  logger: Logger;
  workspaceDir: string;
  stateDir: string;
  memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;
}): Promise<AgentEngine> {
  // Initialize provider manager
  const providerManager = new ProviderManager(params.providerConfig, params.logger);
  await providerManager.initialize();

  // Initialize tool registry
  const toolRegistry = new ToolRegistry({
    logger: params.logger,
    builtInDir: new URL("../tools/built-in", import.meta.url).pathname,
    dynamicDir: new URL("../tools/dynamic", import.meta.url).pathname,
  });
  await toolRegistry.initialize();

  // Create and return engine
  return new AgentEngine({
    config: params.config,
    logger: params.logger,
    providerManager,
    toolRegistry,
    workspaceDir: params.workspaceDir,
    stateDir: params.stateDir,
    memorySearch: params.memorySearch,
  });
}

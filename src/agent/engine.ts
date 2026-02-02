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
  ToolPart,
  AgentConfig,
  ChatOptions,
  ChatResponse,
  CronContext,
  ToolPolicy,
  LLMProvider,
} from "./types.js";
import type { Logger } from "../log.js";
import { ToolRegistry } from "./tool-registry.js";
import type { SessionManager } from "../gateway/session-manager.js";
import {
  ProviderManager,
  withRetry,
  coerceToFailoverError,
} from "./providers.js";
import { getEventStream, createEventPublishers } from "../monitor/event-stream.js";
import {
  buildSystemPrompt,
  loadBootstrapFiles,
  trimMessagesForContext,
  estimateTokens,
  type RuntimeInfo,
  type MemoryContext,
} from "./prompt-builder.js";
import { persistToolResult } from "./tool-result-guard.js";

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
  toolPolicies?: Record<string, ToolPolicy>;
  sessionManager?: SessionManager;
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
  private readonly toolPolicies?: Record<string, ToolPolicy>;
  private readonly sessionManager?: SessionManager;

  constructor(params: AgentEngineConfig) {
    this.config = params.config;
    this.logger = params.logger;
    this.providers = params.providerManager;
    this.tools = params.toolRegistry;
    this.workspaceDir = params.workspaceDir;
    this.stateDir = params.stateDir;
    this.memorySearch = params.memorySearch;
    this.toolPolicies = params.toolPolicies;
    this.sessionManager = params.sessionManager;
  }

  /**
   * Execute an agent task
   */
  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    let iterations = 0;
    const events = createEventPublishers(getEventStream());
    const toolParts = new Map<string, ToolPart>();
    const blockedTools = new Map<string, number>();
    const maxDeniedAttempts = 3;

    try {
      this.logger.info({ sessionKey: input.sessionKey, query: input.query.slice(0, 100) }, "Agent execution started");

      // Publish reasoning start
      await events.agentThinking({
        query: input.query,
        iterationCount: 0 
      }, { sessionKey: input.sessionKey, channel: input.channel });

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
      this.logger.info({
        sessionKey: input.sessionKey,
        providerId: provider.id,
        providerType: provider.type,
        model: provider.model,
        query: input.query.slice(0, 100),
      }, "Provider selected for execution");
      const toolPolicyName = this.config.toolPolicy;
      const toolPolicy = toolPolicyName ? this.toolPolicies?.[toolPolicyName] : undefined;
      const toolPolicyContext = {
        channel: input.channel,
        sessionKey: input.sessionKey,
        chatId: input.chatId,
        model: provider.model,
        isSubagent: input.isSubagent,
      };
      const toolDefs = typeof (this.tools as ToolRegistry).getDefinitionsForPolicy === "function"
        ? (this.tools as ToolRegistry).getDefinitionsForPolicy(toolPolicy, toolPolicyContext)
        : this.tools.getDefinitions();
      const allowedToolNames = new Set(toolDefs.map((tool) => tool.function.name));

      // 5. Execute tool loop
      let currentMessages: Message[] = [...trimmedMessages];
      const maxIterations = this.config.maxToolIterations || 6;
      const toolLoopConfig = this.config.toolLoop ?? {};
      const iterationTimeoutMs = toolLoopConfig.timeoutPerIterationMs ?? 30_000;
      const toolTimeoutMs = toolLoopConfig.timeoutPerToolMs ?? 30_000;
      const contextThresholdPercent = toolLoopConfig.contextWindowThresholdPercent ?? 80;
      const maxHistoryTokens = this.config.maxHistoryTokens;

      while (iterations < maxIterations) {
        iterations++;

        this.logger.debug({ iteration: iterations }, "Tool loop iteration");
        
        // Update thinking status
        await events.agentThinking({
          iterationCount: iterations,
          elapsed: Date.now() - startTime,
          toolsUsed
        }, { sessionKey: input.sessionKey, channel: input.channel });

        if (this.config.compaction?.enabled !== false) {
          const compacted = this.compactSessionHistory(currentMessages, maxHistoryTokens);
          if (compacted.messages !== currentMessages) {
            currentMessages = compacted.messages;
            if (compacted.didCompact) {
              this.logger.info(
                { dropped: compacted.dropped, summaryTokens: compacted.summaryTokens },
                "Session history compacted"
              );
            }
          }
        }

        // Call LLM with retry
        const sanitizedMessages = this.ensureToolResults(currentMessages);
        if (sanitizedMessages !== currentMessages) {
          currentMessages = sanitizedMessages;
        }
        const response = await withRetry(
          () =>
            this.callProviderWithTimeout(
              provider,
              sanitizedMessages,
              {
                temperature: this.config.temperature,
                tools: toolDefs,
                toolChoice: "auto",
                thinking: this.config.thinking?.level
                  ? { level: this.config.thinking.level }
                  : undefined,
              },
              iterationTimeoutMs
            ),
          {
            onRetry: ({ attempt, delayMs, error, reason }) => {
              this.logger.warn(
                { attempt, delayMs, reason, error: error.message },
                "Provider call failed, retrying"
              );
            },
          }
        ).catch((err) => {
          const failover = coerceToFailoverError(err, { providerId: provider.id, model: provider.model });
          if (failover) {
            const providerWithAuth = provider as LLMProvider & { markAuthFailure?: () => void };
            if (failover.reason === "auth" && typeof providerWithAuth.markAuthFailure === "function") {
              providerWithAuth.markAuthFailure();
            }
            this.logger.warn(
              { providerId: provider.id, model: provider.model, reason: failover.reason, error: failover.message },
              "Provider call failed with classified error"
            );
            throw failover;
          }
          throw err;
        });

        // Check if we have tool calls
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // No more tool calls, we're done
           const finalResponse = this.config.thinking?.level && this.config.thinking.level !== "off"
             ? response.content
             : this.stripReasoning(response.content);

          this.logger.info(
            { 
              iterations, 
              toolsUsed, 
              duration: Date.now() - startTime,
              rawResponseLength: response.content?.length || 0,
              rawResponsePreview: response.content?.slice(0, 200) || "(empty)",
              finalResponseLength: finalResponse?.length || 0,
              finalResponsePreview: finalResponse?.slice(0, 200) || "(empty)",
            },
            "Agent execution complete"
          );

          await events.agentResponse({
            iterations,
            toolsUsed,
            duration: Date.now() - startTime,
            success: true
          }, { sessionKey: input.sessionKey, channel: input.channel });

          return {
            response: finalResponse,
            toolsUsed,
            iterations,
            providerId: provider.id,
            model: provider.model,
          };
        }

        // Add assistant message with tool calls
        currentMessages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
          metadata: {
            providerId: provider.id,
            model: provider.model,
            usage: response.usage,
            finishReason: response.finishReason,
          },
        });

        if (this.isContextThresholdReached(currentMessages, maxHistoryTokens, contextThresholdPercent)) {
          this.logger.warn(
            { thresholdPercent: contextThresholdPercent },
            "Context window threshold reached, stopping tool loop"
          );
          return {
            response: "Context window nearly full. Stopping tool calls and responding with available information.",
            toolsUsed,
            iterations,
            providerId: provider.id,
            model: provider.model,
            error: "Context window threshold reached",
          };
        }

        // Execute tools
        for (const toolCall of response.toolCalls) {
          toolsUsed.push(toolCall.name);

          if (!allowedToolNames.has(toolCall.name)) {
            const attempts = (blockedTools.get(toolCall.name) ?? 0) + 1;
            blockedTools.set(toolCall.name, attempts);
            const errorMessage = `Tool '${toolCall.name}' is not allowed by policy`;
            const blockedResult: ToolResult = { ok: false, error: errorMessage };
            const blockedPart = this.createToolPart(toolCall, "error", {
              error: errorMessage,
            });
            toolParts.set(toolCall.id, blockedPart);
            await this.emitToolPartUpdate(blockedPart, input, events);

            if (this.config.toolResultGuard?.enabled !== false) {
              await persistToolResult({
                sessionManager: this.sessionManager,
                sessionKey: input.sessionKey,
                toolCall,
                result: blockedResult,
                toolPart: blockedPart,
                logger: this.logger,
              });
            }

            await events.toolExecuted({
              name: toolCall.name,
              success: false,
              duration: 0,
              error: errorMessage,
            }, { sessionKey: input.sessionKey, channel: input.channel });

            currentMessages.push({
              role: "tool",
              content: this.formatToolResult(blockedResult),
              toolCallId: toolCall.id,
              name: toolCall.name,
            });

            if (attempts >= maxDeniedAttempts) {
              this.logger.warn(
                { tool: toolCall.name, attempts },
                "Blocked tool called repeatedly; stopping tool loop"
              );
              return {
                response: `Tool '${toolCall.name}' is blocked. Please approve or adjust tool policy.`,
                toolsUsed,
                iterations,
                providerId: provider.id,
                model: provider.model,
                error: "Tool blocked by policy",
              };
            }
            continue;
          }
          
          await events.toolExecuting(
            { name: toolCall.name, args: toolCall.arguments },
            { sessionKey: input.sessionKey, channel: input.channel }
          );

          const pendingPart = this.createToolPart(toolCall, "pending", {
            raw: "",
          });
          toolParts.set(toolCall.id, pendingPart);
          await this.emitToolPartUpdate(pendingPart, input, events);

          const runningPart = this.createToolPart(toolCall, "running", {
            timeStart: Date.now(),
          });
          toolParts.set(toolCall.id, runningPart);
          await this.emitToolPartUpdate(runningPart, input, events);

          const toolContext = this.createToolContext(input);
          const result = await this.executeToolWithRecovery(toolCall, toolContext, toolTimeoutMs);

          const completedPart = result.ok
            ? this.createToolPart(toolCall, "completed", {
                output: this.formatToolResult(result),
                timeStart: (runningPart.state.status === "running" ? runningPart.state.time.start : Date.now()),
                metadata: result.metadata as Record<string, unknown> | undefined,
              })
            : this.createToolPart(toolCall, "error", {
                error: result.error ?? "Tool execution failed",
                timeStart: (runningPart.state.status === "running" ? runningPart.state.time.start : Date.now()),
                metadata: result.metadata as Record<string, unknown> | undefined,
              });
          toolParts.set(toolCall.id, completedPart);
          await this.emitToolPartUpdate(completedPart, input, events);

          if (this.config.toolResultGuard?.enabled !== false) {
            await persistToolResult({
              sessionManager: this.sessionManager,
              sessionKey: input.sessionKey,
              toolCall,
              result,
              toolPart: completedPart,
              logger: this.logger,
            });
          }

          await events.toolExecuted({
            name: toolCall.name,
            success: result.ok,
            duration: result.metadata?.duration || 0,
            error: result.error,
          }, { sessionKey: input.sessionKey, channel: input.channel });

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

      const finalResponse = "I've reached the maximum number of tool iterations. Here's what I've done so far.";
      
      await events.agentResponse({
        iterations,
        toolsUsed,
        duration: Date.now() - startTime,
        success: false
      }, { sessionKey: input.sessionKey, channel: input.channel });

      return {
        response: finalResponse,
        toolsUsed,
        iterations,
        error: "Max iterations reached",
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ error, duration: Date.now() - startTime }, "Agent execution failed");

      await this.failOpenToolParts(toolParts, input, events, "Tool execution aborted");
      
      try {
        await events.errorOccurred({
            errorType: "agent_execution_error",
            severity: "high",
            message: error,
            context: { sessionKey: input.sessionKey }
        }, { sessionKey: input.sessionKey, channel: input.channel });
      } catch {}

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
    ctx: ToolContext,
    defaultTimeoutMs: number
  ): Promise<ToolResult> {
    this.logger.debug({ tool: toolCall.name, args: toolCall.arguments }, "Executing tool");

    try {
      const tool = typeof this.tools.get === "function" ? this.tools.get(toolCall.name) : undefined;
      const timeoutMs = tool?.meta.timeoutMs ?? defaultTimeoutMs;
      const result = await this.withTimeout(
        this.tools.execute(toolCall.name, toolCall.arguments, ctx),
        timeoutMs,
        `Tool execution timed out after ${timeoutMs}ms`
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

  private async callProviderWithTimeout(
    provider: { chat: (messages: Message[], options?: ChatOptions) => Promise<ChatResponse> },
    messages: Message[],
    options: ChatOptions,
    timeoutMs: number
  ) {
    return this.withTimeout(
      provider.chat(messages, options),
      timeoutMs,
      `Provider call timed out after ${timeoutMs}ms`
    );
  }

  private isContextThresholdReached(
    messages: Message[],
    maxHistoryTokens: number,
    thresholdPercent: number
  ): boolean {
    const estimatedTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content ?? ""), 0);
    const threshold = Math.floor((maxHistoryTokens * thresholdPercent) / 100);
    return estimatedTokens >= threshold;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]);
  }

  private ensureToolResults(messages: Message[]): Message[] {
    const toolResults = new Set(
      messages
        .filter((msg) => msg.role === "tool" && msg.toolCallId)
        .map((msg) => msg.toolCallId as string)
    );

    const updated: Message[] = [];
    let changed = false;
    for (const msg of messages) {
      updated.push(msg);
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        for (const call of msg.toolCalls) {
          if (!toolResults.has(call.id)) {
            updated.push({
              role: "tool",
              content: this.formatToolResult({
                ok: false,
                error: "[Tool execution was interrupted]",
              }),
              toolCallId: call.id,
              name: call.name,
            });
            toolResults.add(call.id);
            changed = true;
          }
        }
      }
    }

    return changed ? updated : messages;
  }

  private createToolPart(
    toolCall: ToolCall,
    status: "pending" | "running" | "completed" | "error",
    options: {
      raw?: string;
      timeStart?: number;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
    }
  ): ToolPart {
    if (status === "pending") {
      return {
        id: toolCall.id,
        callId: toolCall.id,
        tool: toolCall.name,
        state: {
          status: "pending",
          input: toolCall.arguments,
          raw: options.raw ?? "",
        },
      };
    }

    if (status === "running") {
      return {
        id: toolCall.id,
        callId: toolCall.id,
        tool: toolCall.name,
        state: {
          status: "running",
          input: toolCall.arguments,
          time: { start: options.timeStart ?? Date.now() },
          metadata: options.metadata,
        },
      };
    }

    if (status === "completed") {
      return {
        id: toolCall.id,
        callId: toolCall.id,
        tool: toolCall.name,
        state: {
          status: "completed",
          input: toolCall.arguments,
          output: options.output ?? "",
          title: toolCall.name,
          metadata: options.metadata,
          time: {
            start: options.timeStart ?? Date.now(),
            end: Date.now(),
          },
        },
      };
    }

    return {
      id: toolCall.id,
      callId: toolCall.id,
      tool: toolCall.name,
      state: {
        status: "error",
        input: toolCall.arguments,
        error: options.error ?? "Tool execution failed",
        metadata: options.metadata,
        time: {
          start: options.timeStart ?? Date.now(),
          end: Date.now(),
        },
      },
    };
  }

  private async emitToolPartUpdate(
    part: ToolPart,
    input: AgentInput,
    events: ReturnType<typeof createEventPublishers>
  ): Promise<void> {
    if (this.sessionManager) {
      await this.sessionManager.upsertToolPart(input.sessionKey, part);
    }
    await events.toolPartUpdated(
      { toolPart: part },
      { sessionKey: input.sessionKey, channel: input.channel }
    );
  }

  private async failOpenToolParts(
    toolParts: Map<string, ToolPart>,
    input: AgentInput,
    events: ReturnType<typeof createEventPublishers>,
    errorMessage: string
  ): Promise<void> {
    for (const [id, part] of toolParts.entries()) {
      if (part.state.status === "pending" || part.state.status === "running") {
        const failed: ToolPart = {
          ...part,
          state: {
            status: "error",
            input: part.state.input,
            error: errorMessage,
            metadata: part.state.status === "running" ? part.state.metadata : undefined,
            time: {
              start:
                part.state.status === "running"
                  ? part.state.time.start
                  : Date.now(),
              end: Date.now(),
            },
          },
        };
        toolParts.set(id, failed);
        await this.emitToolPartUpdate(failed, input, events);
      }
    }
  }

  private compactSessionHistory(messages: Message[], maxHistoryTokens: number): {
    messages: Message[];
    didCompact: boolean;
    dropped: number;
    summaryTokens: number;
  } {
    const config = this.config.compaction ?? {};
    const thresholdPercent = config.thresholdPercent ?? 75;
    const maxSummaryTokens = config.maxSummaryTokens ?? 600;
    const minRecentMessages = config.minRecentMessages ?? 8;
    const threshold = Math.floor((maxHistoryTokens * thresholdPercent) / 100);
    const estimatedTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content ?? ""), 0);
    if (estimatedTokens < threshold) {
      return { messages, didCompact: false, dropped: 0, summaryTokens: 0 };
    }

    const system = messages.find((msg) => msg.role === "system");
    const rest = messages.filter((msg) => msg.role !== "system");
    if (rest.length <= minRecentMessages) {
      return { messages, didCompact: false, dropped: 0, summaryTokens: 0 };
    }

    const recent = rest.slice(-minRecentMessages);
    const older = rest.slice(0, -minRecentMessages);
    const summary = this.buildSummaryMessage(older, maxSummaryTokens);
    const summaryTokens = estimateTokens(summary.content);
    const compacted = system ? [system, summary, ...recent] : [summary, ...recent];
    return {
      messages: compacted,
      didCompact: true,
      dropped: older.length,
      summaryTokens,
    };
  }

  private buildSummaryMessage(messages: Message[], maxSummaryTokens: number): Message {
    const summaryLines: string[] = [];
    for (const msg of messages) {
      const role = msg.role;
      const content = msg.content?.trim();
      if (!content) continue;
      const line = `${role}: ${content}`;
      summaryLines.push(line);
    }
    let summaryText = summaryLines.join("\n");
    const maxChars = maxSummaryTokens * 4;
    if (summaryText.length > maxChars) {
      summaryText = summaryText.slice(0, maxChars);
    }
    return {
      role: "system",
      content: `Earlier conversation summary (compacted):\n${summaryText}`,
    };
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
      authProfiles?: Array<{ apiKey: string; label?: string; cooldownMinutes?: number }>;
      model: string;
      command?: string;
      args?: string[];
      healthCheckTimeoutMs?: number;
      healthCheckCacheTtlMinutes?: number;
    }>;
    defaultProvider: string;
    routing?: {
      chat?: string;
      tools?: string;
      embeddings?: string;
      subagent?: string;
    };
  };
  logger: Logger;

  workspaceDir: string;
  stateDir: string;
  memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;
  toolPolicies?: Record<string, ToolPolicy>;
  sessionManager?: SessionManager;
}): Promise<AgentEngine> {
  // Initialize provider manager
  const defaultHealthTimeout = Math.min(params.config.toolLoop?.timeoutPerIterationMs ?? 5000, 10_000);
  const healthTimeouts = Object.values(params.providerConfig.providers)
    .map((provider) => provider.healthCheckTimeoutMs)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const healthTtls = Object.values(params.providerConfig.providers)
    .map((provider) => provider.healthCheckCacheTtlMinutes)
    .filter((value): value is number => typeof value === "number" && value > 0)
    .map((value) => value * 60 * 1000);
  const providerManager = new ProviderManager(
    {
      ...params.providerConfig,
      healthCheck: {
        timeoutMs: healthTimeouts.length > 0 ? Math.min(...healthTimeouts) : defaultHealthTimeout,
        cacheTtlMs: healthTtls.length > 0 ? Math.min(...healthTtls) : 5 * 60 * 1000,
      },
    },
    params.logger
  );
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
    toolPolicies: params.toolPolicies,
    sessionManager: params.sessionManager,
  });
}

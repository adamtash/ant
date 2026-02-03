/**
 * Agent Engine - Core execution engine for the ANT agent
 *
 * Features:
 * - Unified tool loop with max iterations
 * - Provider routing and fallback
 * - Memory context integration
 * - Error recovery and retry logic
 * - Subagent spawning support
 * - Dynamic context window detection
 */

import crypto from "node:crypto";

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
  isFailoverError,
  resolveFailoverReasonFromError,
  type FailoverReason,
  type ProviderManagerConfig,
} from "./providers.js";
import { getEventStream, createEventPublishers } from "../monitor/event-stream.js";
import { emitAgentEvent, registerAgentRunContext, clearAgentRunContext } from "../monitor/agent-events.js";
import { createClassifiedErrorData } from "../monitor/error-classifier.js";
import { getModelContextInfo } from "./context-window-registry.js";
import { registerActiveRun, clearActiveRun } from "./active-runs.js";
import {
  buildSystemPrompt,
  loadBootstrapFiles,
  trimMessagesForContext,
  estimateTokens,
  type RuntimeInfo,
  type MemoryContext,
} from "./prompt-builder.js";
import { persistToolResult } from "./tool-result-guard.js";
import { resolveTierForIntent, type RoutingTierName } from "../routing/tier-resolver.js";
import { parseToolCallsFromText } from "./tool-call-parser.js";

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
  onProviderError?: (params: {
    sessionKey: string;
    failedProvider: string;
    error: string;
    retryingProvider?: string;
  }) => Promise<void>;
}

/**
 * Agent Engine - Main execution class
 */
export class AgentEngine {
  private config: AgentConfig;
  private readonly logger: Logger;
  private readonly providers: ProviderManager;
  private readonly tools: ToolRegistry;
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;
  private toolPolicies?: Record<string, ToolPolicy>;
  private readonly sessionManager?: SessionManager;
  private readonly onProviderError?: (params: {
    sessionKey: string;
    failedProvider: string;
    error: string;
    retryingProvider?: string;
  }) => Promise<void>;

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
    this.onProviderError = params.onProviderError;
  }

  /**
   * Execute an agent task
   */
  async execute(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const toolsUsed: string[] = [];
    let iterations = 0;
    const cfg = this.config;
    const events = createEventPublishers(getEventStream());
    const toolParts = new Map<string, ToolPart>();
    const blockedTools = new Map<string, number>();
    const maxDeniedAttempts = 3;
    const agentType = input.isSubagent ? "subagent" : "agent";
    const promptPreview = input.query.slice(0, 300);
    const runId = input.runId ?? `run-${crypto.randomUUID()}`;
    let runOutcome: "success" | "error" | "max_iterations" | "unknown" = "unknown";

    registerAgentRunContext(runId, { sessionKey: input.sessionKey, agentType });
    registerActiveRun({
      runId,
      sessionKey: input.sessionKey,
      agentType,
      startedAt: startTime,
      metadata: { channel: input.channel },
    });

    emitAgentEvent({
      runId,
      stream: "lifecycle",
      data: {
        stage: "start",
        agentType,
        channel: input.channel,
        promptPreview,
      },
      sessionKey: input.sessionKey,
    });

    try {
      this.logger.info(
        {
          sessionKey: input.sessionKey,
          channel: input.channel,
          agentType,
          promptPreview,
          runId,
        },
        "Agent execution started"
      );

      // Publish reasoning start
      await events.agentThinking({
        query: input.query,
        iterationCount: 0,
        agentType,
      }, { sessionKey: input.sessionKey, channel: input.channel });

      const tier = resolveTierForIntent({
        query: input.query,
        channel: input.channel,
        isSubagent: input.isSubagent,
        cronContext: input.cronContext,
      });
      const tierModel = this.providers.getTierConfig(tier)?.model;

      // 1. Select providers (chat vs tool-runner)
      const chatProvider = await this.providers.selectBestProvider("chat", { tier });
      let selectedProvider = chatProvider;

      if (chatProvider.type === "cli") {
        try {
          selectedProvider = await this.providers.selectBestProvider("parentForCli", { tier, requireTools: true });
        } catch (err) {
          this.logger.warn(
            { error: err instanceof Error ? err.message : String(err), chatProvider: chatProvider.id },
            "No parent provider available for CLI chat provider; continuing without tool execution"
          );
          selectedProvider = chatProvider;
        }
      } else {
        try {
          selectedProvider = await this.providers.selectBestProvider("tools", { tier, requireTools: true });
        } catch {
          selectedProvider = chatProvider;
        }
      }

      this.logger.info(
        {
          sessionKey: input.sessionKey,
          tier,
          chatProviderId: chatProvider.id,
          chatProviderType: chatProvider.type,
          chatModel: chatProvider.model,
          toolProviderId: selectedProvider.id,
          toolProviderType: selectedProvider.type,
          toolModel: selectedProvider.model,
          ...(tierModel ? { tierModel } : {}),
          query: input.query.slice(0, 100),
        },
        "Providers selected for execution"
      );

      // 2. Prepare prompt context (bootstrap + memory)
      const bootstrapFiles = await loadBootstrapFiles({
        workspaceDir: this.workspaceDir,
        isSubagent: input.isSubagent,
      });

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
          this.logger.debug(
            { error: err instanceof Error ? err.message : String(err) },
            "Memory search failed"
          );
        }
      }

      const baseRuntimeInfo = {
        workspaceDir: this.workspaceDir,
        currentTime: new Date(),
        cronContext: input.cronContext,
      };

      const toolSystemPrompt = buildSystemPrompt({
        config: cfg,
        tools: this.tools.getDefinitions(),
        bootstrapFiles,
        runtimeInfo: {
          ...baseRuntimeInfo,
          model: selectedProvider.model,
          providerType: selectedProvider.type === "cli" ? "cli" : "openai",
        },
        memoryContext,
        isSubagent: input.isSubagent,
      });

      const chatSystemPrompt =
        chatProvider.id === selectedProvider.id
          ? toolSystemPrompt
          : buildSystemPrompt({
              config: cfg,
              tools: [],
              bootstrapFiles,
              runtimeInfo: {
                ...baseRuntimeInfo,
                model: chatProvider.model,
                providerType: chatProvider.type === "cli" ? "cli" : "openai",
              },
              memoryContext,
              isSubagent: input.isSubagent,
            });

      // 3. Build initial messages (tool-runner loop)
      const messages: Message[] = [
        { role: "system", content: toolSystemPrompt },
        ...(input.history || []),
        { role: "user", content: input.query },
      ];

      // 4. Trim messages to fit context window
      const trimmedMessages = trimMessagesForContext(messages, cfg.maxHistoryTokens);

      // 5. Get tool definitions (policy-aware)
      const toolPolicyName = input.toolPolicy ?? cfg.toolPolicy;
      const toolPolicy = toolPolicyName ? this.toolPolicies?.[toolPolicyName] : undefined;
      const toolPolicyContext = {
        channel: input.channel,
        sessionKey: input.sessionKey,
        chatId: input.chatId,
        model: selectedProvider.model,
        isSubagent: input.isSubagent,
      };
      const toolDefs = typeof (this.tools as ToolRegistry).getDefinitionsForPolicy === "function"
        ? (this.tools as ToolRegistry).getDefinitionsForPolicy(toolPolicy, toolPolicyContext)
        : this.tools.getDefinitions();
      const allowedToolNames = new Set(toolDefs.map((tool) => tool.function.name));

      // 6. Execute tool loop
      let currentMessages: Message[] = [...trimmedMessages];
      const maxIterations = cfg.maxToolIterations || 6;
      const toolLoopConfig = cfg.toolLoop ?? {};
      const iterationTimeoutMs = toolLoopConfig.timeoutPerIterationMs ?? 30_000;
      const toolTimeoutMs = toolLoopConfig.timeoutPerToolMs ?? 30_000;
      const contextThresholdPercent = toolLoopConfig.contextWindowThresholdPercent ?? 50; // Lower default to trigger compaction earlier
      const maxHistoryTokens = cfg.maxHistoryTokens;

      while (iterations < maxIterations) {
        iterations++;

        this.logger.debug({ iteration: iterations }, "Tool loop iteration");
        
        // Update thinking status
        await events.agentThinking({
          iterationCount: iterations,
          elapsed: Date.now() - startTime,
          toolsUsed
        }, { sessionKey: input.sessionKey, channel: input.channel });

        if (cfg.compaction?.enabled !== false) {
          const compacted = this.compactSessionHistory(currentMessages, maxHistoryTokens, cfg);
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

        // Call LLM with provider fallback
        const sanitizedMessages = this.ensureToolResults(currentMessages);
        if (sanitizedMessages !== currentMessages) {
          currentMessages = sanitizedMessages;
        }
        
        let response: ChatResponse;
        try {
          const callResult = await this.callProviderWithFallback(
            selectedProvider,
            sanitizedMessages,
            {
              temperature: cfg.temperature,
              model: tierModel,
              timeoutMs: iterationTimeoutMs,
              tools: toolDefs,
              toolChoice: "auto",
              thinking: cfg.thinking?.level
                ? { level: cfg.thinking.level }
                : undefined,
            },
            iterationTimeoutMs,
            input.sessionKey,
            { tier }
          );
          response = callResult.response;
          // Update selectedProvider in case fallback was used
          selectedProvider = callResult.provider;
        } catch (err) {
          // Final error after all fallbacks exhausted
          const providerError = err instanceof Error ? err : new Error(String(err));
          await events.errorOccurred(
            createClassifiedErrorData(providerError, "high", {
              providerId: selectedProvider.id,
              model: selectedProvider.model,
              sessionKey: input.sessionKey,
            }),
            { sessionKey: input.sessionKey, channel: input.channel }
          );
          const failover = coerceToFailoverError(err, { providerId: selectedProvider.id, model: selectedProvider.model });
          if (failover) {
            this.logger.error(
              { sessionKey: input.sessionKey, reason: failover.reason, error: failover.message },
              "All provider fallbacks exhausted"
            );
          }
          throw err;
        }

        // Check if we have tool calls
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // No more tool calls, we're done
          const toolRunnerResponse =
            cfg.thinking?.level && cfg.thinking.level !== "off"
              ? response.content
              : this.stripReasoning(response.content);

          let finalProvider = selectedProvider;
          let finalResponse = toolRunnerResponse;

          const providerToolsDisabled =
            ["1", "true", "yes"].includes((process.env.ANT_DISABLE_PROVIDER_TOOLS || "").trim().toLowerCase()) ||
            ["1", "true", "yes"].includes((process.env.ANT_EXEC_BLOCK_DELETE || "").trim().toLowerCase());

          if (chatProvider.id !== selectedProvider.id && !(providerToolsDisabled && chatProvider.type === "cli")) {
            const toolMessages = currentMessages
              .filter((m) => m.role === "tool")
              .slice(-12)
              .map((m) => {
                const name = m.name || "tool";
                const content = typeof m.content === "string" ? m.content : String(m.content ?? "");
                const trimmed = content.length > 4000 ? content.slice(0, 4000) + "…(truncated)" : content;
                return `- ${name}: ${trimmed}`;
              });

            const finalUserPrompt = toolMessages.length > 0
              ? `User request:\n${input.query}\n\nTool outputs:\n${toolMessages.join("\n")}\n\nWrite the final answer for the user. Do not call tools.`
              : `User request:\n${input.query}\n\nWrite the final answer for the user.`;

            try {
              const chatResult = await this.callProviderWithFallback(
                chatProvider,
                [
                  { role: "system", content: chatSystemPrompt },
                  { role: "user", content: finalUserPrompt },
                ],
                {
                  temperature: cfg.temperature,
                  model: tierModel,
                  timeoutMs: iterationTimeoutMs,
                  thinking: cfg.thinking?.level
                    ? { level: cfg.thinking.level }
                    : undefined,
                },
                iterationTimeoutMs,
                input.sessionKey,
                { tier }
              );

              finalProvider = chatResult.provider;
              finalResponse =
                cfg.thinking?.level && cfg.thinking.level !== "off"
                  ? chatResult.response.content
                  : this.stripReasoning(chatResult.response.content);
            } catch (err) {
              this.logger.warn(
                { error: err instanceof Error ? err.message : String(err), providerId: chatProvider.id },
                "Final chat provider call failed; falling back to tool-runner response"
              );
            }
          } else if (chatProvider.id !== selectedProvider.id && providerToolsDisabled && chatProvider.type === "cli") {
            this.logger.info(
              { sessionKey: input.sessionKey, providerId: chatProvider.id },
              "Skipping CLI chat provider finalization (provider tools disabled)"
            );
          }

          this.logger.info(
            {
              iterations,
              toolsUsed,
              duration: Date.now() - startTime,
              agentType,
              promptPreview,
              rawResponseLength: response.content?.length || 0,
              rawResponsePreview: response.content?.slice(0, 300) || "(empty)",
              finalResponseLength: finalResponse?.length || 0,
              finalResponsePreview: finalResponse?.slice(0, 300) || "(empty)",
              providerId: finalProvider.id,
              model: finalProvider.model,
              toolProviderId: selectedProvider.id,
              toolModel: selectedProvider.model,
            },
            "Agent execution complete"
          );

          await events.agentResponse({
            iterations,
            toolsUsed,
            duration: Date.now() - startTime,
            success: true,
            responsePreview: finalResponse?.slice(0, 300) || "",
            promptPreview,
            providerId: finalProvider.id,
            model: finalProvider.model,
            agentType,
          }, { sessionKey: input.sessionKey, channel: input.channel });

          emitAgentEvent({
            runId,
            stream: "assistant",
            data: {
              responsePreview: finalResponse?.slice(0, 300) || "",
              success: true,
              iterations,
              toolsUsed,
              duration: Date.now() - startTime,
              providerId: finalProvider.id,
              model: finalProvider.model,
              toolProviderId: selectedProvider.id,
              toolModel: selectedProvider.model,
              agentType,
            },
            sessionKey: input.sessionKey,
          });

          runOutcome = "success";

          return {
            response: finalResponse,
            toolsUsed,
            iterations,
            providerId: finalProvider.id,
            model: finalProvider.model,
            runId,
          };
        }

        // Add assistant message with tool calls
        currentMessages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
          metadata: {
            providerId: selectedProvider.id,
            model: selectedProvider.model,
            usage: response.usage,
            finishReason: response.finishReason,
          },
        });

        if (this.isContextThresholdReached(currentMessages, maxHistoryTokens, contextThresholdPercent)) {
          this.logger.warn(
            { 
              currentTokens: this.estimateMessageTokens(currentMessages),
              maxTokens: maxHistoryTokens,
              thresholdPercent: contextThresholdPercent,
              messageCount: currentMessages.length 
            },
            "Context threshold reached, attempting emergency compaction"
          );

          // Try emergency compaction before giving up
          const emergencyCompacted = await this.aggressivelyCompactHistory(
            currentMessages,
            maxHistoryTokens,
            selectedProvider,
            input.sessionKey,
            cfg
          );

          if (this.estimateMessageTokens(emergencyCompacted) < this.estimateMessageTokens(currentMessages)) {
            currentMessages = emergencyCompacted;
            this.logger.info(
              { 
                beforeTokens: this.estimateMessageTokens(emergencyCompacted),
                afterTokens: this.estimateMessageTokens(currentMessages)
              },
              "Emergency compaction successful, continuing tool loop"
            );
          } else {
            // Compaction didn't help, must stop
            this.logger.error(
              { thresholdPercent: contextThresholdPercent },
              "Context window full even after emergency compaction, stopping tool loop"
            );
            emitAgentEvent({
              runId,
              stream: "assistant",
              data: {
                responsePreview: "Context window nearly full. Stopping tool calls and responding with available information.",
                success: false,
                iterations,
                toolsUsed,
                duration: Date.now() - startTime,
                providerId: selectedProvider.id,
                model: selectedProvider.model,
                agentType,
                reason: "context_threshold",
              },
              sessionKey: input.sessionKey,
            });
            runOutcome = "error";
            return {
              response: "Context window nearly full. Stopping tool calls and responding with available information.",
              toolsUsed,
              iterations,
              providerId: selectedProvider.id,
              model: selectedProvider.model,
              error: "Context window threshold reached",
              runId,
            };
          }
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

            if (cfg.toolResultGuard?.enabled !== false) {
              await persistToolResult({
                sessionManager: this.sessionManager,
                sessionKey: input.sessionKey,
                channel: input.channel,
                chatId: input.chatId,
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
              emitAgentEvent({
                runId,
                stream: "assistant",
                data: {
                  responsePreview: `Tool '${toolCall.name}' is blocked. Please approve or adjust tool policy.`,
                  success: false,
                  iterations,
                  toolsUsed,
                  duration: Date.now() - startTime,
                  providerId: selectedProvider.id,
                  model: selectedProvider.model,
                  agentType,
                  reason: "tool_blocked",
                },
                sessionKey: input.sessionKey,
              });
              runOutcome = "error";
              return {
                response: `Tool '${toolCall.name}' is blocked. Please approve or adjust tool policy.`,
                toolsUsed,
                iterations,
                providerId: selectedProvider.id,
                model: selectedProvider.model,
                error: "Tool blocked by policy",
                runId,
              };
            }
            continue;
          }
          
          await events.toolExecuting(
            { name: toolCall.name, args: toolCall.arguments },
            { sessionKey: input.sessionKey, channel: input.channel }
          );

          emitAgentEvent({
            runId,
            stream: "tool",
            data: {
              name: toolCall.name,
              args: toolCall.arguments,
              status: "start",
            },
            sessionKey: input.sessionKey,
          });

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

          const toolContext = this.createToolContext(input, cfg);
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

          if (cfg.toolResultGuard?.enabled !== false) {
            await persistToolResult({
              sessionManager: this.sessionManager,
              sessionKey: input.sessionKey,
              channel: input.channel,
              chatId: input.chatId,
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

          emitAgentEvent({
            runId,
            stream: "tool",
            data: {
              name: toolCall.name,
              status: result.ok ? "completed" : "error",
              duration: result.metadata?.duration || 0,
              error: result.error,
            },
            sessionKey: input.sessionKey,
          });

          if (!result.ok) {
            await events.errorOccurred(
              createClassifiedErrorData(result.error ?? "Tool execution failed", "medium", {
                tool: toolCall.name,
                sessionKey: input.sessionKey,
              }),
              { sessionKey: input.sessionKey, channel: input.channel }
            );
          }

          // Add tool result to messages
          currentMessages.push({
            role: "tool",
            content: this.formatToolResult(result),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });

          // Check and apply aggressive compaction if approaching threshold
          // This is more aggressive than the iteration-start compaction
          const currentTokens = this.estimateMessageTokens(currentMessages);
          const AggressiveThreshold = Math.floor((maxHistoryTokens * 60) / 100); // 60% threshold for mid-loop
          if (currentTokens > AggressiveThreshold) {
            const aggressivelyCompacted = await this.aggressivelyCompactHistory(
              currentMessages,
              maxHistoryTokens,
              selectedProvider,
              input.sessionKey,
              cfg
            );
            if (aggressivelyCompacted !== currentMessages) {
              currentMessages = aggressivelyCompacted;
            }
          }
        }
      }

      // Max iterations reached
      this.logger.warn({ iterations }, "Max tool iterations reached");

      const finalResponse = "I've reached the maximum number of tool iterations. Here's what I've done so far.";
      
      await events.agentResponse({
        iterations,
        toolsUsed,
        duration: Date.now() - startTime,
        success: false,
        responsePreview: finalResponse.slice(0, 300),
        promptPreview,
        providerId: selectedProvider.id,
        model: selectedProvider.model,
        agentType,
      }, { sessionKey: input.sessionKey, channel: input.channel });

      emitAgentEvent({
        runId,
        stream: "assistant",
        data: {
          responsePreview: finalResponse.slice(0, 300),
          success: false,
          iterations,
          toolsUsed,
          duration: Date.now() - startTime,
          providerId: selectedProvider.id,
          model: selectedProvider.model,
          agentType,
          reason: "max_iterations",
        },
        sessionKey: input.sessionKey,
      });

      runOutcome = "max_iterations";

      return {
        response: finalResponse,
        toolsUsed,
        iterations,
        error: "Max iterations reached",
        runId,
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

      emitAgentEvent({
        runId,
        stream: "error",
        data: {
          message: error,
          duration: Date.now() - startTime,
          agentType,
        },
        sessionKey: input.sessionKey,
      });

      runOutcome = "error";

      return {
        response: `I encountered an error: ${error}`,
        toolsUsed,
        iterations,
        error,
        runId,
      };
    } finally {
      emitAgentEvent({
        runId,
        stream: "lifecycle",
        data: {
          stage: "end",
          outcome: runOutcome,
          duration: Date.now() - startTime,
          agentType,
        },
        sessionKey: input.sessionKey,
      });
      clearActiveRun(runId);
      clearAgentRunContext(runId);
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
  private createToolContext(input: AgentInput, config: AgentConfig): ToolContext {
    return {
      workspaceDir: this.workspaceDir,
      stateDir: this.stateDir,
      sessionKey: input.sessionKey,
      chatId: input.chatId,
      logger: this.logger.child({ component: "tool" }),
      config,
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
    provider: LLMProvider,
    messages: Message[],
    options: ChatOptions,
    timeoutMs: number
  ) {
    return this.withTimeout(
      provider.chat(messages, options),
      timeoutMs,
      `Provider ${provider.id} (${provider.name}/${provider.model}) called timed out after ${timeoutMs}ms`
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
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
    });

    return Promise.race([
      promise.finally(() => {
        if (timer) clearTimeout(timer);
      }),
      timeout,
    ]);
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

  private compactSessionHistory(messages: Message[], maxHistoryTokens: number, agentConfig: AgentConfig): {
    messages: Message[];
    didCompact: boolean;
    dropped: number;
    summaryTokens: number;
  } {
    const config = agentConfig.compaction ?? {};
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
   * Estimate total tokens in a message array
   */
  private estimateMessageTokens(messages: Message[]): number {
    return messages.reduce((sum, msg) => sum + estimateTokens(msg.content ?? ""), 0);
  }

  /**
   * Aggressively compact history when approaching context limit
   * Uses staged approach: first try simple summaries, then progressively prune
   */
  private async aggressivelyCompactHistory(
    messages: Message[],
    maxHistoryTokens: number,
    provider: LLMProvider,
    sessionKey: string,
    agentConfig: AgentConfig
  ): Promise<Message[]> {
    const config = agentConfig.compaction ?? {};
    const targetTokens = Math.floor((maxHistoryTokens * 50) / 100); // Aim for 50% of max

    this.logger.info(
      {
        currentTokens: this.estimateMessageTokens(messages),
        targetTokens,
        messageCount: messages.length,
      },
      "Starting aggressive context compaction"
    );

    // Step 1: Extract system message (keep it)
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");

    if (nonSystemMsgs.length <= 4) {
      // Too few messages to compact, try pruning instead
      return this.pruneOldestMessages(messages, targetTokens, systemMsg);
    }

    // Step 2: Try simple compaction first (keep last 4 messages, summarize rest)
    const minRecentMessages = config.minRecentMessages ?? 4;
    if (nonSystemMsgs.length > minRecentMessages) {
      const older = nonSystemMsgs.slice(0, -minRecentMessages);
      const recent = nonSystemMsgs.slice(-minRecentMessages);

      // Build summary with marker indicating it was compacted
      const summary = this.buildSummaryMessage(older, config.maxSummaryTokens ?? 600);
      const compacted = systemMsg ? [systemMsg, summary, ...recent] : [summary, ...recent];
      const compactedTokens = this.estimateMessageTokens(compacted);

      this.logger.debug(
        { beforeTokens: this.estimateMessageTokens(messages), afterTokens: compactedTokens },
        "Simple compaction applied"
      );

      if (compactedTokens <= targetTokens) {
        return compacted;
      }
    }

    // Step 3: If simple compaction didn't work, try aggressive pruning
    this.logger.warn(
      { messageCount: nonSystemMsgs.length },
      "Simple compaction insufficient, using aggressive pruning"
    );
    return this.pruneOldestMessages(messages, targetTokens, systemMsg);
  }

  /**
   * Split messages into chunks by rough token distribution
   */
  private splitMessagesIntoChunks(messages: Message[], numChunks: number): Message[][] {
    if (messages.length <= numChunks) {
      return messages.map((m) => [m]);
    }

    const totalTokens = this.estimateMessageTokens(messages);
    const tokensPerChunk = Math.ceil(totalTokens / numChunks);

    const chunks: Message[][] = [];
    let currentChunk: Message[] = [];
    let currentTokens = 0;

    for (const msg of messages) {
      const msgTokens = estimateTokens(msg.content ?? "");
      currentChunk.push(msg);
      currentTokens += msgTokens;

      if (currentTokens >= tokensPerChunk && chunks.length < numChunks - 1) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Aggressively prune oldest messages until within token budget
   */
  private pruneOldestMessages(
    messages: Message[],
    targetTokens: number,
    systemMsg?: Message
  ): Message[] {
    const nonSystemMsgs = messages.filter((m) => m.role !== "system");
    const kept: Message[] = systemMsg ? [systemMsg] : [];

    // Keep last N messages, drop oldest
    const NUM_PARTS = 3;
    const chunks = this.splitMessagesIntoChunks(nonSystemMsgs, NUM_PARTS);

    // Try to keep last chunk first, then progressively add earlier chunks
    for (let i = chunks.length - 1; i >= 0; i--) {
      const testMessages = [...kept, ...chunks[i], ...chunks.slice(i + 1).flat()];
      const tokens = this.estimateMessageTokens(testMessages);

      if (tokens <= targetTokens) {
        kept.push(...chunks[i]);
      }
    }

    // If still over budget, keep only system + last few messages
    if (this.estimateMessageTokens(kept) > targetTokens) {
      const kept2 = systemMsg ? [systemMsg] : [];
      kept2.push(...nonSystemMsgs.slice(-2)); // Keep just last 2 messages
      return kept2;
    }

    return kept;
  }

  /**
   * Get tool registry (for external access)
   */
  getToolRegistry(): ToolRegistry {
    return this.tools;
  }

  async hasHealthyProvider(opts?: { requireTools?: boolean }): Promise<boolean> {
    try {
      await this.providers.selectBestProvider("chat", { requireTools: opts?.requireTools });
      return true;
    } catch {
      return false;
    }
  }

  applyProviderRoutingHotReload(routing: ProviderManagerConfig["routing"] | undefined): void {
    this.providers.updateRouting(routing);
  }

  applyProviderFallbackChainHotReload(fallbackChain: string[] | undefined): void {
    this.providers.updateFallbackChain(fallbackChain);
  }

  async registerDiscoveredProvider(params: {
    id: string;
    config: ProviderManagerConfig["providers"][string];
    ensureFallbackChain?: boolean;
  }): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
    return this.providers.registerDiscoveredProvider(params.id, params.config as any, {
      ensureFallbackChain: params.ensureFallbackChain,
    });
  }

  unregisterProvider(id: string): boolean {
    return this.providers.unregisterProvider(id);
  }

  applyToolPoliciesHotReload(next: Record<string, ToolPolicy> | undefined): void {
    this.toolPolicies = next;
  }

  applyHotReload(next: Partial<AgentConfig>): void {
    const merged: AgentConfig = {
      ...this.config,
      ...next,
      ...(next.thinking ? { thinking: { ...(this.config.thinking ?? {}), ...next.thinking } } : {}),
      ...(next.toolLoop ? { toolLoop: { ...(this.config.toolLoop ?? {}), ...next.toolLoop } } : {}),
      ...(next.compaction ? { compaction: { ...(this.config.compaction ?? {}), ...next.compaction } } : {}),
      ...(next.toolResultGuard
        ? { toolResultGuard: { ...(this.config.toolResultGuard ?? {}), ...next.toolResultGuard } }
        : {}),
    };
    this.config = merged;
  }

  /**
   * Call a provider with fallback to other providers on failure
   * Tries providers in order: first the given provider, then others from fallback chain
   */
  private async callProviderWithFallback(
    provider: LLMProvider,
    messages: Message[],
    options: ChatOptions,
    iterationTimeoutMs: number,
    sessionKey: string,
    opts?: { tier?: RoutingTierName }
  ): Promise<{ response: ChatResponse; provider: LLMProvider }> {
    const events = createEventPublishers(getEventStream());
    const mapCooldownReason = (reason?: FailoverReason | null): "rate_limit" | "quota" | "auth" | "maintenance" | "error" => {
      switch (reason) {
        case "rate_limit":
          return "rate_limit";
        case "billing":
          return "quota";
        case "auth":
          return "auth";
        default:
          return "error";
      }
    };
    const requireTools = Boolean(options.tools && options.tools.length > 0);
    // Prioritize the primary provider first, then tier escalation, then fallback chain
    const providerIds = this.providers.getPrioritizedProviderIds(provider.id, {
      tier: opts?.tier,
      requireTools,
    });
    
    this.logger.debug(
      { primaryProvider: provider.id, providerOrder: providerIds },
      "Provider fallback order"
    );
    
    let lastError: Error | null = null;
    
    for (const attemptedProviderId of providerIds) {
      const attemptedProvider = this.providers.getProviderById(attemptedProviderId);
      if (!attemptedProvider) continue;

      if (this.providers.isProviderCoolingDown(attemptedProviderId)) {
        this.logger.warn({ providerId: attemptedProviderId }, "Provider in cooldown, skipping attempt");
        continue;
      }

      // Skip if this is not our primary provider and we haven't exhausted the primary yet
      // (unless the primary has already failed with a fatal error)
      const isPrimary = attemptedProvider.id === provider.id;
      
      this.logger.debug(
        { attemptedProviderId, isPrimary, providerId: provider.id },
        "Attempting provider"
      );

      try {
        let response = await withRetry(
          () =>
            this.callProviderWithTimeout(
              attemptedProvider,
              messages,
              options,
              iterationTimeoutMs
            ),
          {
            maxRetries: isPrimary ? 3 : 1, // Retry primary more aggressively
            onRetry: ({ attempt, delayMs, error, reason }) => {
              this.logger.warn(
                { attempt, delayMs, reason, error: error.message, providerId: attemptedProviderId },
                "Provider call failed, retrying"
              );
            },
          }
        );

        if (requireTools && (!response.toolCalls || response.toolCalls.length === 0)) {
          const parsed = parseToolCallsFromText(response.content);
          if (parsed.ok) {
            response = {
              ...response,
              content: parsed.cleanedContent,
              toolCalls: parsed.toolCalls,
              finishReason: "tool_calls",
            };
          } else if (parsed.hadMarkup || parsed.truncated || response.finishReason === "length") {
            this.logger.warn(
              {
                sessionKey,
                providerId: attemptedProvider.id,
                model: attemptedProvider.model,
                error: parsed.error,
                truncated: parsed.truncated,
                finishReason: response.finishReason,
              },
              "Tool call parsing failed; retrying once with strict JSON tool call prompt"
            );

            const repairPrompt = [
              "Your previous response attempted a tool call but was invalid/truncated.",
              "Return ONLY valid JSON (no markdown, no xml) in this exact shape:",
              '{"toolCalls":[{"name":"tool_name","arguments":{}}]}',
              "Choose tool_name from the available tools and include all required arguments.",
            ].join("\n");

            const repairResponse = await this.callProviderWithTimeout(
              attemptedProvider,
              [...messages, { role: "user", content: repairPrompt }],
              {
                ...options,
                tools: options.tools,
                toolChoice: "none",
                temperature: 0,
                maxTokens: Math.max(options.maxTokens ?? 0, 1200),
              },
              iterationTimeoutMs
            );

            if (repairResponse.toolCalls && repairResponse.toolCalls.length > 0) {
              response = repairResponse;
            } else {
              const repairedParsed = parseToolCallsFromText(repairResponse.content);
              if (repairedParsed.ok) {
                response = {
                  ...repairResponse,
                  content: repairedParsed.cleanedContent,
                  toolCalls: repairedParsed.toolCalls,
                  finishReason: "tool_calls",
                };
              } else {
                throw new Error("Tool call parsing failed after repair attempt");
              }
            }
          }
        }

        this.logger.info(
          {
            sessionKey,
            providerId: attemptedProvider.id,
            succeeded: true,
            contentLength: response.content?.length || 0,
            contentPreview: response.content?.slice(0, 100) || "(no content)",
            finishReason: response.finishReason,
            hasToolCalls: (response.toolCalls?.length || 0) > 0,
            toolCallCount: response.toolCalls?.length || 0,
            usage: response.usage,
          },
          "Provider call succeeded"
        );

        const recovery = this.providers.recordProviderSuccess(attemptedProvider.id);
        if (recovery.recovered) {
          await events.providerRecovery({
            providerId: attemptedProvider.id,
            providerName: attemptedProvider.name,
            recoveredAt: Date.now(),
          }, { sessionKey });
        }

        return { response, provider: attemptedProvider };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        await events.errorOccurred(
          createClassifiedErrorData(lastError, "medium", {
            providerId: attemptedProvider.id,
            model: attemptedProvider.model,
            sessionKey,
          }),
          { sessionKey }
        );
        const failover = coerceToFailoverError(lastError, {
          providerId: attemptedProvider.id,
          model: attemptedProvider.model,
        });
        const failoverReason = failover?.reason ?? resolveFailoverReasonFromError(lastError);
        const cooldown = this.providers.recordProviderFailure(attemptedProvider.id, failoverReason);
        if (cooldown.opened) {
          await events.providerCooldown({
            providerId: attemptedProvider.id,
            providerName: attemptedProvider.name,
            reason: mapCooldownReason(failoverReason),
            until: cooldown.cooldownUntil,
          }, { sessionKey });
        }

        // Mark auth failures
        if (failover && isFailoverError(failover)) {
          const providerWithAuth = attemptedProvider as LLMProvider & { markAuthFailure?: () => void };
          if (failover.reason === "auth" && typeof providerWithAuth.markAuthFailure === "function") {
            providerWithAuth.markAuthFailure();
          }

          // Check if this is a fatal error that should cause immediate fallback
          const isFatalError = ["auth", "billing", "format"].includes(failover.reason);
          
          this.logger.error(
            {
              sessionKey,
              providerId: attemptedProvider.id,
              model: attemptedProvider.model,
              reason: failover.reason,
              errorMessage: failover.message,
              isFatal: isFatalError,
              attemptedProviderId,
              nextProvider: providerIds[providerIds.indexOf(attemptedProviderId) + 1],
              rawError: lastError.message,
              fullStack: lastError.stack,
            },
            "Provider call failed with classified error"
          );

          // Notify user if switching providers
          const nextProviderIndex = providerIds.indexOf(attemptedProviderId) + 1;
          if (nextProviderIndex < providerIds.length && this.onProviderError) {
            const nextProviderId = providerIds[nextProviderIndex];
            try {
              await this.onProviderError({
                sessionKey,
                failedProvider: attemptedProviderId,
                error: `${failover.reason}: ${failover.message}`,
                retryingProvider: nextProviderId,
              });
            } catch (err2) {
              this.logger.warn({ error: err2 }, "Failed to send provider error notification");
            }
          }

          // Continue to next provider in fallback chain
        } else {
          this.logger.error(
            {
              sessionKey,
              providerId: attemptedProvider.id,
              error: lastError.message,
              fullStack: lastError.stack,
              attemptedProviderId,
              nextProvider: providerIds[providerIds.indexOf(attemptedProviderId) + 1],
              willRetryOtherProviders: true,
            },
            "Provider call failed"
          );

          // Notify user if switching providers
          const nextProviderIndex = providerIds.indexOf(attemptedProviderId) + 1;
          if (nextProviderIndex < providerIds.length && this.onProviderError) {
            const nextProviderId = providerIds[nextProviderIndex];
            try {
              await this.onProviderError({
                sessionKey,
                failedProvider: attemptedProviderId,
                error: lastError.message,
                retryingProvider: nextProviderId,
              });
            } catch (err2) {
              this.logger.warn({ error: err2 }, "Failed to send provider error notification");
            }
          }
        }

        // Continue to next provider in priority order
      }
    }

    // All providers exhausted
    this.logger.error(
      { sessionKey, lastError: lastError?.message, totalProviders: providerIds.length },
      "All providers exhausted"
    );
    throw lastError || new Error("No providers available");
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
    fallbackChain?: string[];
    routing?: {
      chat?: string;
      tools?: string;
      embeddings?: string;
      summary?: string;
      subagent?: string;
      parentForCli?: string;
      tiers?: Record<
        string,
        {
          provider: string;
          model?: string;
          maxLatencyMs?: number;
          fallbackFromFast?: boolean;
        }
      >;
    };
  };
  logger: Logger;

  workspaceDir: string;
  stateDir: string;
  memorySearch?: (query: string, maxResults?: number) => Promise<string[]>;
  toolPolicies?: Record<string, ToolPolicy>;
  sessionManager?: SessionManager;
  onProviderError?: (params: {
    sessionKey: string;
    failedProvider: string;
    error: string;
    retryingProvider?: string;
  }) => Promise<void>;
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

  // Detect model context window and auto-adjust maxHistoryTokens if needed
  let effectiveConfig = { ...params.config };
  const defaultMaxHistoryTokens = 40_000; // Default from config schema
  
  if (effectiveConfig.maxHistoryTokens === defaultMaxHistoryTokens) {
    // User hasn't explicitly set maxHistoryTokens, try to auto-detect from model
    try {
      const defaultProviderId = params.providerConfig.defaultProvider;
      const defaultProvider = params.providerConfig.providers[defaultProviderId];
      
      if (defaultProvider?.model) {
        const contextInfo = getModelContextInfo(defaultProvider.model);
        if (contextInfo.maxHistoryTokens > defaultMaxHistoryTokens) {
          const oldValue = effectiveConfig.maxHistoryTokens;
          effectiveConfig.maxHistoryTokens = contextInfo.maxHistoryTokens;
          
          params.logger.info(
            {
              model: defaultProvider.model,
              contextWindow: contextInfo.contextWindow,
              oldMaxHistory: oldValue,
              newMaxHistory: contextInfo.maxHistoryTokens,
              label: contextInfo.label,
            },
            "Auto-detected model context window, increased maxHistoryTokens"
          );
        }
      }
    } catch (err) {
      params.logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to auto-detect context window, using default"
      );
    }
  }

  // Initialize tool registry
  const toolRegistry = new ToolRegistry({
    logger: params.logger,
    builtInDir: new URL("../tools/built-in", import.meta.url).pathname,
    dynamicDir: new URL("../tools/dynamic", import.meta.url).pathname,
  });
  await toolRegistry.initialize();

  // Create and return engine
  return new AgentEngine({
    config: effectiveConfig,
    logger: params.logger,
    providerManager,
    toolRegistry,
    workspaceDir: params.workspaceDir,
    stateDir: params.stateDir,
    memorySearch: params.memorySearch,
    toolPolicies: params.toolPolicies,
    sessionManager: params.sessionManager,
    onProviderError: params.onProviderError,
  });
}

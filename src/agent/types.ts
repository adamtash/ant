/**
 * Core Types for the ANT Agent System
 *
 * This file defines the fundamental types used across the agent engine,
 * tool system, and channel interfaces.
 */

// ============================================================================
// Message Types
// ============================================================================

/**
 * Channel types for multi-channel support
 */
export type Channel = "whatsapp" | "cli" | "web" | "telegram" | "discord";

/**
 * Normalized message format that all channels convert to/from
 */
export interface NormalizedMessage {
  id: string;
  channel: Channel;
  sender: {
    id: string;
    name: string;
    isAgent: boolean;
  };
  content: string;
  media?: {
    type: "image" | "video" | "audio" | "file";
    data: Buffer | string;
    mimeType?: string;
    filename?: string;
  };
  context: {
    sessionKey: string;
    chatId?: string;
    threadId?: string;
  };
  timestamp: number;
  isReply?: boolean;
  priority: "high" | "normal" | "low";
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * JSON Schema type for tool parameters
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema | { type: string; description?: string; enum?: string[] }>;
  required?: string[];
  items?: JSONSchema | { type: string };
  description?: string;
  enum?: string[];
  default?: unknown;
}

/**
 * Standard tool result format - ALL tools return this
 */
export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    duration?: number;
    mediaPath?: string;
    [key: string]: unknown;
  };
}

/**
 * Tool metadata
 */
export interface ToolMeta {
  name: string;
  description: string;
  category: string;
  version: string;
  author?: string;
}

/**
 * Tool context passed to every tool execution
 */
export interface ToolContext {
  workspaceDir: string;
  stateDir: string;
  sessionKey: string;
  chatId?: string;
  logger: Logger;
  config: AgentConfig;
}

/**
 * Standard tool interface - all tools implement this
 */
export interface Tool {
  meta: ToolMeta;
  parameters: JSONSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Input to the agent engine
 */
export interface AgentInput {
  sessionKey: string;
  query: string;
  channel: Channel;
  chatId?: string;
  isSubagent?: boolean;
  cronContext?: CronContext;
  history?: Message[];
}

/**
 * Output from the agent engine
 */
export interface AgentOutput {
  response: string;
  toolsUsed: string[];
  iterations: number;
  media?: {
    path: string;
    type: "image" | "video" | "audio" | "file";
  }[];
  error?: string;
}

/**
 * Chat message in history
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
  name?: string;
  timestamp?: number;
}

/**
 * Cron context for scheduled tasks
 */
export interface CronContext {
  jobId: string;
  jobName: string;
  schedule: string;
  triggeredAt: number;
}

// ============================================================================
// Provider Types
// ============================================================================

/**
 * LLM Provider type
 */
export type ProviderType = "cli" | "openai" | "ollama";

/**
 * CLI Provider type
 */
export type CLIProviderType = "copilot" | "claude" | "codex";

/**
 * Chat completion options
 */
export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

/**
 * Chat completion response
 */
export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Tool definition for LLM
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

/**
 * LLM Provider interface
 */
export interface LLMProvider {
  type: ProviderType;
  id: string;
  name: string;

  /** Main completion endpoint */
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;

  /** For embedding (memory search) */
  embeddings?(texts: string[]): Promise<number[][]>;

  /** Provider health check */
  health(): Promise<boolean>;

  /** Estimate token cost */
  estimateCost?(messages: Message[]): number;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Agent-specific configuration
 */
export interface AgentConfig {
  systemPrompt?: string;
  maxHistoryTokens: number;
  temperature: number;
  maxToolIterations: number;
}

/**
 * Provider configuration item
 */
export interface ProviderConfig {
  type: ProviderType;
  cliProvider?: CLIProviderType;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  contextWindow?: number;
  embeddingsModel?: string;
}

// ============================================================================
// Logging Types
// ============================================================================

/**
 * Log levels
 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

/**
 * Logger interface
 */
export interface Logger {
  trace(obj: object | string, msg?: string): void;
  debug(obj: object | string, msg?: string): void;
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
  error(obj: object | string, msg?: string): void;
  child(bindings: object): Logger;
}

// ============================================================================
// Event Types (for monitoring)
// ============================================================================

/**
 * Event types for monitoring system
 */
export type EventType =
  | "message_received"
  | "tool_executed"
  | "agent_thinking"
  | "subagent_spawned"
  | "cron_triggered"
  | "error_occurred"
  | "memory_indexed"
  | "session_started"
  | "session_ended";

/**
 * Base event structure
 */
export interface Event {
  id: string;
  type: EventType;
  timestamp: number;
  sessionKey?: string;
  channel?: Channel;
  data: Record<string, unknown>;
}

// ============================================================================
// Scheduler Types
// ============================================================================

/**
 * Cron job definition
 */
export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  trigger: {
    type: "agent_ask" | "tool_call" | "webhook";
    prompt?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  actions?: {
    type: "memory_update" | "send_message" | "log_event";
    channel?: Channel;
    recipient?: string;
    content?: string;
  }[];
  retryOnFailure?: boolean;
  maxRetries?: number;
  timeout?: number;
  lastRun?: number;
  lastResult?: "success" | "failure";
}

// ============================================================================
// Skill Registry Types
// ============================================================================

/**
 * Registered skill in SKILL_REGISTRY.md
 */
export interface RegisteredSkill {
  name: string;
  createdAt: string;
  author: string;
  purpose: string;
  usage: string;
  parameters: string;
  examples?: string[];
  status?: string;
  cronSchedule?: string;
}

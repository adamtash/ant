/**
 * Agent Module - Core agent engine and related components
 *
 * This module exports the main agent engine, tool registry, provider system,
 * and prompt builder for the ANT agent system.
 */

// Core Engine
export { AgentEngine, createAgentEngine, type AgentEngineConfig } from "./engine.js";

// Tool System
export { ToolRegistry, defineTool, defineParams } from "./tool-registry.js";

// Provider System
export {
  ProviderManager,
  OpenAIProvider,
  CLIProvider,
  OllamaProvider,
  withRetry,
  type ProviderManagerConfig,
  type RetryOptions,
} from "./providers.js";

// Prompt Builder
export {
  buildSystemPrompt,
  loadBootstrapFiles,
  estimateTokens,
  trimMessagesForContext,
  type RuntimeInfo,
  type MemoryContext,
  type PromptBuilderOptions,
  type BootstrapFile,
} from "./prompt-builder.js";

// Self-Improvement System
export {
  SkillGenerator,
  createSkillGenerator,
  type SkillDefinition,
  type SkillParameter,
  type SkillGenerationResult,
} from "./skill-generator.js";

export {
  SkillRegistryManager,
  createSkillRegistryManager,
  type SkillStatus,
} from "./skill-registry.js";

export {
  SourceUpdater,
  createSourceUpdater,
  type FileChange,
  type UpdateResult,
  type DiffHunk,
} from "./source-updater.js";

export {
  RestartManager,
  createRestartManager,
  getRestartManager,
  isRestartExitCode,
  RESTART_EXIT_CODE,
  type RestartReason,
  type TaskContext,
  type RestartState,
  type RestartResult,
  type ShutdownHandler,
} from "./restart-manager.js";

// Types
export type {
  // Message Types
  Channel,
  NormalizedMessage,
  // Tool Types
  JSONSchema,
  ToolResult,
  ToolMeta,
  ToolContext,
  Tool,
  ToolCall,
  ToolDefinition,
  // Agent Types
  AgentInput,
  AgentOutput,
  Message,
  CronContext,
  // Provider Types
  ProviderType,
  CLIProviderType,
  ChatOptions,
  ChatResponse,
  LLMProvider,
  ProviderConfig,
  // Config Types
  AgentConfig,
  // Logging Types
  LogLevel,
  Logger,
  // Event Types
  EventType,
  Event,
  // Scheduler Types
  CronJob,
  // Skill Types
  RegisteredSkill,
} from "./types.js";

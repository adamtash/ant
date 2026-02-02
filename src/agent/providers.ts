/**
 * LLM Provider System - Unified interface for multiple LLM backends
 *
 * Features:
 * - OpenAI-compatible API support
 * - CLI tool integration (Copilot, Claude, Codex)
 * - Provider routing with fallback chains
 * - Health checks and cost estimation
 * - Retry logic with exponential backoff
 */

import { spawn } from "node:child_process";
import type {
  LLMProvider,
  ProviderType,
  CLIProviderType,
  Message,
  ChatOptions,
  ChatResponse,
  ToolCall,
  ProviderConfig,
} from "./types.js";
import type { Logger } from "../log.js";

// ============================================================================
// Failover Error Handling
// ============================================================================

export type FailoverReason =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "billing"
  | "format"
  | "compaction"
  | "unknown";

export class FailoverError extends Error {
  readonly reason: FailoverReason;
  readonly providerId?: string;
  readonly model?: string;
  readonly status?: number;
  readonly code?: string;

  constructor(
    message: string,
    params: {
      reason: FailoverReason;
      providerId?: string;
      model?: string;
      status?: number;
      code?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: params.cause });
    this.name = "FailoverError";
    this.reason = params.reason;
    this.providerId = params.providerId;
    this.model = params.model;
    this.status = params.status;
    this.code = params.code;
  }
}

export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

function getStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate =
    (err as { status?: unknown; statusCode?: unknown }).status ??
    (err as { statusCode?: unknown }).statusCode;
  if (typeof candidate === "number") return candidate;
  if (typeof candidate === "string" && /^\d+$/.test(candidate)) {
    return Number(candidate);
  }
  return undefined;
}

function getErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const candidate = (err as { code?: unknown }).code;
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed ? trimmed : undefined;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (typeof err === "symbol") return err.description ?? "";
  if (err && typeof err === "object") {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

const TIMEOUT_HINT_RE = /timeout|timed out|deadline exceeded|context deadline exceeded/i;
const ABORT_TIMEOUT_RE = /request was aborted|request aborted/i;

function hasTimeoutHint(err: unknown): boolean {
  if (!err) return false;
  if (err && typeof err === "object" && "name" in err && err.name === "TimeoutError") {
    return true;
  }
  const message = getErrorMessage(err);
  return Boolean(message && TIMEOUT_HINT_RE.test(message));
}

function isTimeoutError(err: unknown): boolean {
  if (hasTimeoutHint(err)) return true;
  if (!err || typeof err !== "object") return false;
  if ("name" in err && err.name !== "AbortError") return false;
  const message = getErrorMessage(err);
  if (message && ABORT_TIMEOUT_RE.test(message)) return true;
  const cause = "cause" in err ? (err as { cause?: unknown }).cause : undefined;
  const reason = "reason" in err ? (err as { reason?: unknown }).reason : undefined;
  return hasTimeoutHint(cause) || hasTimeoutHint(reason);
}

type ErrorPattern = RegExp | string;
const ERROR_PATTERNS = {
  rateLimit: [
    /rate[_ ]limit|too many requests|429/,
    "quota exceeded",
    "resource has been exhausted",
    "overloaded",
  ],
  timeout: ["timeout", "timed out", "deadline exceeded", "context deadline exceeded"],
  billing: ["payment required", "insufficient credits", "billing", /\b402\b/],
  auth: [
    /invalid[_ ]?api[_ ]?key/,
    "unauthorized",
    "forbidden",
    "invalid token",
    "no api key",
    "authentication",
    "expired",
    /\b401\b/,
    /\b403\b/,
  ],
  format: ["invalid request", "invalid_request_error", "tool_use.id", "tool_use_id"],
  compaction: ["compaction failed", "summarization failed", "auto-compaction"],
} as const;

function matchesErrorPatterns(raw: string, patterns: readonly ErrorPattern[]): boolean {
  if (!raw) return false;
  const value = raw.toLowerCase();
  return patterns.some((pattern) =>
    pattern instanceof RegExp ? pattern.test(value) : value.includes(pattern)
  );
}

export function classifyFailoverReason(raw: string): FailoverReason | null {
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.rateLimit)) return "rate_limit";
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.timeout)) return "timeout";
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.billing)) return "billing";
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.auth)) return "auth";
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.format)) return "format";
  if (matchesErrorPatterns(raw, ERROR_PATTERNS.compaction)) return "compaction";
  return null;
}

function resolveFailoverReasonFromStatus(status?: number, message?: string): FailoverReason | null {
  if (status === 402) return "billing";
  if (status === 429) return "rate_limit";
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  const classified = message ? classifyFailoverReason(message) : null;
  return classified;
}

export function resolveFailoverReasonFromError(err: unknown): FailoverReason | null {
  if (isFailoverError(err)) return err.reason;
  const status = getStatusCode(err);
  const message = getErrorMessage(err);
  if (status) {
    const fromStatus = resolveFailoverReasonFromStatus(status, message);
    if (fromStatus) return fromStatus;
  }
  const code = (getErrorCode(err) ?? "").toUpperCase();
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(code)) {
    return "timeout";
  }
  if (isTimeoutError(err)) return "timeout";
  if (message) return classifyFailoverReason(message);
  return null;
}

export function coerceToFailoverError(
  err: unknown,
  context?: { providerId?: string; model?: string }
): FailoverError | null {
  if (isFailoverError(err)) return err;
  const reason = resolveFailoverReasonFromError(err);
  if (!reason) return null;
  const message = getErrorMessage(err) || String(err);
  const status = getStatusCode(err);
  const code = getErrorCode(err);
  return new FailoverError(message, {
    reason,
    providerId: context?.providerId,
    model: context?.model,
    status,
    code,
    cause: err instanceof Error ? err : undefined,
  });
}

// ============================================================================
// Provider Manager
// ============================================================================

/**
 * Configuration for the provider manager
 */
export interface ProviderManagerConfig {
  providers: Record<string, ProviderConfig>;
  defaultProvider: string;
  fallbackChain?: string[];
  routing?: {
    chat?: string;
    tools?: string;
    embeddings?: string;
    subagent?: string;
  };
  healthCheck?: {
    timeoutMs?: number;
    cacheTtlMs?: number;
  };
}

/**
 * Provider Manager - Routes requests to appropriate providers
 */
export class ProviderManager {
  private readonly providers: Map<string, LLMProvider> = new Map();
  private readonly config: ProviderManagerConfig;
  private readonly logger: Logger;
  private readonly healthCache: Map<string, { ok: boolean; checkedAt: number }> = new Map();

  constructor(config: ProviderManagerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing LLM providers...");

    for (const [id, providerConfig] of Object.entries(this.config.providers)) {
      try {
        const provider = await this.createProvider(id, providerConfig);
        this.providers.set(id, provider);
        this.logger.debug({ id, type: providerConfig.type }, "Provider initialized");
      } catch (err) {
        this.logger.warn(
          { id, error: err instanceof Error ? err.message : String(err) },
          "Failed to initialize provider"
        );
      }
    }

    this.logger.info({ count: this.providers.size }, "LLM providers initialized");
  }

  /**
   * Create a provider instance based on config
   */
  private async createProvider(id: string, config: ProviderConfig): Promise<LLMProvider> {
    switch (config.type) {
      case "openai":
        return new OpenAIProvider({
          id,
          baseUrl: config.baseUrl || "http://localhost:1234/v1",
          apiKey: config.apiKey || "not-needed",
          model: config.model,
          logger: this.logger,
          authProfiles: config.authProfiles,
        });

      case "cli":
        return new CLIProvider({
          id,
          cliType: config.cliProvider || "claude",
          model: config.model,
          logger: this.logger,
          command: config.command,
          args: config.args,
          timeoutMs: config.timeoutMs,
        });

      case "ollama":

        return new OllamaProvider({
          id,
          baseUrl: config.baseUrl || "http://localhost:11434",
          model: config.model,
          logger: this.logger,
        });

      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  /**
   * Get provider for a specific action
   */
  getProvider(action: "chat" | "tools" | "embeddings" | "subagent" = "chat"): LLMProvider {
    const providerId = this.config.routing?.[action] || this.config.defaultProvider;
    const provider = this.providers.get(providerId);

    if (!provider) {
      // Try fallback chain
      for (const fallbackId of this.config.fallbackChain || []) {
        const fallback = this.providers.get(fallbackId);
        if (fallback) {
          this.logger.debug({ action, fallback: fallbackId }, "Using fallback provider");
          return fallback;
        }
      }
      throw new Error(`No provider available for action: ${action}`);
    }

    return provider;
  }

  /**
   * Get provider by ID
   */
  getProviderById(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Select best available provider based on health
   */
  async selectBestProvider(): Promise<LLMProvider> {
    // Check providers in order: routing preference, then fallback chain
    const preferredOrder = [
      this.config.routing?.chat || this.config.defaultProvider,
      ...(this.config.fallbackChain || []),
    ];

    this.logger.debug({ preferredOrder }, "Selecting best provider");

    for (const id of preferredOrder) {
      const provider = this.providers.get(id);
      if (provider) {
        this.logger.debug({ id, type: provider.type }, "Checking provider health");
        try {
          const isHealthy = await this.checkProviderHealth(id, provider);
          this.logger.debug({ id, isHealthy }, "Provider health check result");
          if (isHealthy) {
            return provider;
          }
        } catch (err) {
           this.logger.warn({ id, error: err instanceof Error ? err.message : String(err) }, "Provider health check failed with error");
          // Provider unhealthy, try next
        }
      } else {
        this.logger.warn({ id }, "Provider not found in registry");
      }
    }

    throw new Error("No healthy LLM providers available");
  }


  /**
   * Get all provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  private async checkProviderHealth(id: string, provider: LLMProvider): Promise<boolean> {
    const cacheTtlMs = this.config.healthCheck?.cacheTtlMs ?? 5 * 60 * 1000;
    const timeoutMs = this.config.healthCheck?.timeoutMs ?? 5000;
    const cached = this.healthCache.get(id);
    if (cached && Date.now() - cached.checkedAt < cacheTtlMs) {
      return cached.ok;
    }

    const check = this.withTimeout(provider.health(), timeoutMs, "Provider health check timed out");
    const ok = await check.catch((err) => {
      this.logger.warn(
        { id, error: err instanceof Error ? err.message : String(err) },
        "Provider health check failed with error"
      );
      return false;
    });

    this.healthCache.set(id, { ok, checkedAt: Date.now() });
    return ok;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]);
  }
}

// ============================================================================
// OpenAI Provider
// ============================================================================

interface OpenAIProviderOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  logger: Logger;
  authProfiles?: Array<{ apiKey: string; label?: string; cooldownMinutes?: number }>;
}

/**
 * OpenAI-compatible API provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly type: ProviderType = "openai";
  readonly id: string;
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly authProfiles: Array<{
    apiKey: string;
    label?: string;
    cooldownMinutes?: number;
    cooldownUntil?: number;
    lastUsedAt?: number;
  }>;
  private authProfileIndex = 0;
  private readonly logger: Logger;

  constructor(options: OpenAIProviderOptions) {
    this.id = options.id;
    this.name = `OpenAI (${options.id})`;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.logger = options.logger;
    this.authProfiles = (options.authProfiles ?? []).map((profile) => ({
      apiKey: profile.apiKey,
      label: profile.label,
      cooldownMinutes: profile.cooldownMinutes,
    }));
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        ...(m.toolCalls && {
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        }),
        ...(m.name && { name: m.name }),
      })),
      temperature: options?.temperature ?? 0.2,
    };

    if (options?.maxTokens) {
      body.max_tokens = options.maxTokens;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
      body.tool_choice = options.toolChoice ?? "auto";
    }

    if (options?.thinking?.level && options.thinking.level !== "off") {
      body.reasoning = { effort: options.thinking.level };
    }

    // Log the OpenAI provider call details
    this.logger.info({
      providerId: this.id,
      providerType: "openai",
      model: this.model,
      baseUrl: this.baseUrl,
      messageCount: messages.length,
      hasTools: !!options?.tools && options.tools.length > 0,
      toolCount: options?.tools?.length || 0,
      temperature: options?.temperature ?? 0.2,
      thinkingLevel: options?.thinking?.level,
    }, "OpenAI provider chat call started");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.resolveApiKey()}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = data.choices[0];
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: this.parseArguments(tc.function.arguments),
    }));

    // Log the OpenAI provider call completion
    this.logger.info({
      providerId: this.id,
      providerType: "openai",
      model: this.model,
      success: true,
      finishReason: choice.finish_reason,
      hasToolCalls: !!toolCalls && toolCalls.length > 0,
      toolCallCount: toolCalls?.length || 0,
      contentPreview: (choice.message.content || "").slice(0, 200) + ((choice.message.content || "").length > 200 ? "..." : ""),
      usage: data.usage,
    }, "OpenAI provider chat call completed");

    return {
      content: choice.message.content || "",
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  private parseArguments(args: string): Record<string, unknown> {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }

  private mapFinishReason(reason: string): ChatResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "tool_calls":
      case "function_call":
        return "tool_calls";
      case "length":
        return "length";
      default:
        return "stop";
    }
  }

  async embeddings(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.resolveApiKey()}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Embeddings API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map(d => d.embedding);
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.resolveApiKey()}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  markAuthFailure(): void {
    const active = this.getActiveProfile();
    if (!active) return;
    const cooldownMinutes = active.cooldownMinutes ?? 5;
    active.cooldownUntil = Date.now() + cooldownMinutes * 60 * 1000;
    active.lastUsedAt = Date.now();
    this.authProfileIndex = (this.authProfileIndex + 1) % this.authProfiles.length;
  }

  private resolveApiKey(): string {
    const profile = this.getActiveProfile();
    if (!profile) return this.apiKey;
    profile.lastUsedAt = Date.now();
    return profile.apiKey;
  }

  private getActiveProfile() {
    if (this.authProfiles.length === 0) return undefined;
    const startIndex = this.authProfileIndex;
    for (let offset = 0; offset < this.authProfiles.length; offset++) {
      const idx = (startIndex + offset) % this.authProfiles.length;
      const profile = this.authProfiles[idx];
      if (!profile) continue;
      if (!profile.cooldownUntil || profile.cooldownUntil <= Date.now()) {
        this.authProfileIndex = idx;
        return profile;
      }
    }
    return this.authProfiles[startIndex];
  }

  estimateCost(messages: Message[]): number {
    // Rough cost estimation based on token count
    const tokens = messages.reduce((acc, m) => acc + Math.ceil((m.content?.length || 0) / 4), 0);
    return tokens * 0.00001; // Approximate cost per token
  }
}

// ============================================================================
// CLI Provider
// ============================================================================

interface CLIProviderOptions {
  id: string;
  cliType: CLIProviderType;
  model: string;
  logger: Logger;
  command?: string;
  args?: string[];
  timeoutMs?: number;
}

/**
 * CLI-based LLM provider (Copilot, Claude, Codex)
 */
export class CLIProvider implements LLMProvider {
  readonly type: ProviderType = "cli";
  readonly id: string;
  readonly name: string;
  readonly model: string;

  private readonly logger: Logger;
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;

  readonly cliType: CLIProviderType;

  constructor(options: CLIProviderOptions) {
    this.id = options.id;
    this.cliType = options.cliType;
    this.model = options.model;
    this.name = `CLI (${options.cliType})`;
    this.logger = options.logger;
    this.command = options.command || options.cliType;
    this.args = options.args || [];
    this.timeoutMs = options.timeoutMs || 120000;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    // Build prompt from messages
    const prompt = this.buildPromptFromMessages(messages, options?.thinking?.level);

    // Log the CLI call details
    this.logger.info({
      providerId: this.id,
      cliType: this.cliType,
      model: this.model,
      command: this.command,
      args: this.args,
      promptPreview: prompt.slice(0, 200) + (prompt.length > 200 ? "..." : ""),
      promptLength: prompt.length,
      timeoutMs: this.timeoutMs,
    }, "CLI provider chat call started");

    // Run CLI command
    const result = await this.runCLI(prompt);

    // Log the result
    this.logger.info({
      providerId: this.id,
      cliType: this.cliType,
      success: result.ok,
      outputLength: result.output?.length || 0,
      outputPreview: result.output?.slice(0, 200) + (result.output?.length > 200 ? "..." : ""),
      error: result.error,
    }, "CLI provider chat call completed");

    if (!result.ok) {
      const detail = this.formatCliError(result.error);
      this.logger.warn({ cliType: this.cliType, error: detail }, "CLI command failed");
      throw new Error(`CLI ${this.cliType} error: ${detail}`);
    }

    // Parse output based on CLI type
    let content: string;
    if (this.cliType === "kimi") {
      // Kimi outputs ACP protocol format - parse it
      content = this.parseKimiOutput(result.output);
      this.logger.info({
        rawOutputLength: result.output?.length || 0,
        rawOutputPreview: result.output?.slice(0, 300) || "(empty)",
        parsedContentLength: content?.length || 0,
        parsedContentPreview: content?.slice(0, 200) || "(empty)",
      }, "Kimi output parsed");
    } else {
      // Other CLIs return plain text
      content = this.stripReasoning(result.output);
    }

    return {
      content,
      finishReason: "stop",
    };
  }

  private buildPromptFromMessages(messages: Message[], thinkingLevel?: string): string {
    const parts: string[] = [];

    if (thinkingLevel && thinkingLevel !== "off") {
      parts.push(`System: Thinking level: ${thinkingLevel}`);
    }

    for (const msg of messages) {
      switch (msg.role) {
        case "system":
          parts.push(`System: ${msg.content}`);
          break;
        case "user":
          parts.push(`User: ${msg.content}`);
          break;
        case "assistant":
          parts.push(`Assistant: ${msg.content}`);
          break;
        case "tool":
          parts.push(`Tool result: ${msg.content}`);
          break;
      }
    }

    return parts.join("\n\n");
  }

  private async runCLI(prompt: string): Promise<{ ok: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const args = [...this.args];

      // Add prompt based on CLI type
      switch (this.cliType) {
        case "claude":
          args.push("-p", prompt);
          break;
        case "copilot":
          args.push("--prompt", prompt);
          break;
        case "codex":
          args.push("-q", prompt);
          break;
        case "kimi":
          args.push("-p", prompt, "--print");
          break;
      }

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(this.command, args, {
        env: process.env,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          output: "",
          error: err.message,
        });
      });

        child.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({
            ok: false,
            output: stdout,
            error: `Command timed out after ${this.timeoutMs}ms`,
          });
        } else {
          const error = code !== 0 ? (stderr || stdout || "Command failed") : undefined;
          resolve({
            ok: code === 0,
            output: stdout,
            error,
          });
        }
      });
    });
  }

  private stripReasoning(text: string): string {
    if (!text) return text;
    
    // Strip <think> tags (Claude-style reasoning)
    const endTag = "</think>";
    const idx = text.lastIndexOf(endTag);
    if (idx !== -1) {
      text = text.slice(idx + endTag.length).trim();
    }
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    
    // Strip <choice> tags (Kimi-style control tokens)
    text = text.replace(/<choice>.*?<\/choice>/gs, "").trim();
    
    return text;
  }

  private formatCliError(error?: string): string {
    const detail = (error || "Unknown error").trim();
    if (detail.length > 500) {
      return `${detail.slice(0, 500)}...`;
    }
    return detail;
  }

  /**
   * Parse Kimi CLI output format (ACP protocol) to extract assistant's text
   */
  private parseKimiOutput(output: string): string {
    if (!output) return "";
    
    // Strip any echo of the input prompt that appears before the first TurnBegin
    const firstTurnBegin = output.indexOf("TurnBegin(");
    if (firstTurnBegin > 0) {
      output = output.slice(firstTurnBegin);
    }
    
    // Split output into turns
    const turns: string[] = [];
    let currentTurn: string[] = [];
    
    for (const line of output.split("\n")) {
      if (line.trim().startsWith("TurnBegin(")) {
        if (currentTurn.length > 0) {
          turns.push(currentTurn.join("\n"));
        }
        currentTurn = [line];
      } else {
        currentTurn.push(line);
      }
    }
    if (currentTurn.length > 0) {
      turns.push(currentTurn.join("\n"));
    }
    
    const textParts: string[] = [];
    
    for (const turn of turns) {
      // Skip turns with loop control messages (these are Kimi's internal loop controls)
      if (turn.includes("You are running in an automated loop") ||
          turn.includes("Available branches:")) {
        continue;
      }
      
      // Find all TextPart blocks in this turn using regex
      // TextPart can be multiline, so we need to match across lines
      const textPartRegex = /TextPart\([\s\S]*?type=['"]text['"][\s\S]*?text=['"]([\s\S]*?)['"]\s*\)/g;
      let match;
      
      while ((match = textPartRegex.exec(turn)) !== null) {
        let text = match[1];
        
        // Unescape quotes
        text = text.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, "\n");
        
        // Skip if it looks like system or user content
        if (text.startsWith("System:") || text.startsWith("User:")) {
          continue;
        }
        
        textParts.push(text);
      }
    }
    
    // Join and clean up
    let result = textParts.join("\n").trim();
    result = result.replace(/<choice>.*?<\/choice>/gs, "").trim();
    
    return result;
  }

  async health(): Promise<boolean> {
    // Check if CLI binary exists
    return new Promise((resolve) => {
      this.logger.debug({ command: this.command }, "Checking CLI health");
      const child = spawn(this.command, ["--version"], {
        env: process.env,
      });

      const timer = setTimeout(() => {
        child.kill();
        this.logger.warn({ command: this.command }, "CLI health check timed out");
        resolve(false);
      }, 5000);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
            this.logger.warn({ command: this.command, code }, "CLI health check failed");
        }
        resolve(code === 0);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        this.logger.warn({ command: this.command, error: err.message }, "CLI health check error");
        resolve(false);
      });
    });
  }


  estimateCost(): number {
    // CLI tools are typically free (subscription-based)
    return 0;
  }
}

// ============================================================================
// Ollama Provider
// ============================================================================

interface OllamaProviderOptions {
  id: string;
  baseUrl: string;
  model: string;
  logger: Logger;
}

/**
 * Ollama provider for local models
 */
export class OllamaProvider implements LLMProvider {
  readonly type: ProviderType = "ollama";
  readonly id: string;
  readonly name: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly logger: Logger;

  constructor(options: OllamaProviderOptions) {
    this.id = options.id;
    this.name = `Ollama (${options.model})`;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.logger = options.logger;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl}/api/chat`;

    const body = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.2,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      message: { content: string };
    };

    return {
      content: data.message.content,
      finishReason: "stop",
    };
  }

  async embeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (const text of texts) {
      const url = `${this.baseUrl}/api/embeddings`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama embeddings error: ${response.status}`);
      }

      const data = await response.json() as { embedding: number[] };
      results.push(data.embedding);
    }

    return results;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  estimateCost(): number {
    // Ollama is free (local)
    return 0;
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Retry options
 */
export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: Error; reason?: FailoverReason }) => void;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 300000,
  backoffMultiplier: 2,
};

/**
 * Execute with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const reason = resolveFailoverReasonFromError(lastError);

      // Check if error is retryable
      if (!isRetryableError(lastError, reason) || attempt === opts.maxRetries) {
        throw lastError;
      }

      // Wait before retrying
      opts.onRetry?.({ attempt: attempt + 1, delayMs: delay, error: lastError, reason: reason || undefined });
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error, reason?: FailoverReason | null): boolean {
  if (reason === "billing" || reason === "format" || reason === "compaction" || reason === "auth") {
    return false;
  }
  if (reason === "rate_limit" || reason === "timeout") {
    return true;
  }
  const message = error.message.toLowerCase();
  const retryablePatterns = [
    "timeout",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network",
    "503",
    "502",
    "504",
    "rate limit",
    "too many requests",
  ];

  return retryablePatterns.some(pattern => message.includes(pattern));
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

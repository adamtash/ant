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
}

/**
 * Provider Manager - Routes requests to appropriate providers
 */
export class ProviderManager {
  private readonly providers: Map<string, LLMProvider> = new Map();
  private readonly config: ProviderManagerConfig;
  private readonly logger: Logger;

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
        });

      case "cli":
        return new CLIProvider({
          id,
          cliType: config.cliProvider || "claude",
          model: config.model,
          logger: this.logger,
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

    for (const id of preferredOrder) {
      const provider = this.providers.get(id);
      if (provider) {
        try {
          if (await provider.health()) {
            return provider;
          }
        } catch {
          // Provider unhealthy, try next
        }
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
}

/**
 * OpenAI-compatible API provider
 */
export class OpenAIProvider implements LLMProvider {
  readonly type: ProviderType = "openai";
  readonly id: string;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(options: OpenAIProviderOptions) {
    this.id = options.id;
    this.name = `OpenAI (${options.id})`;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.logger = options.logger;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId && { tool_call_id: m.toolCallId }),
        ...(m.toolCalls && { tool_calls: m.toolCalls }),
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

    this.logger.debug({ url, model: this.model }, "OpenAI request");

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
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
        "Authorization": `Bearer ${this.apiKey}`,
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
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
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
  private readonly cliType: CLIProviderType;
  private readonly model: string;
  private readonly logger: Logger;
  private readonly command: string;
  private readonly args: string[];
  private readonly timeoutMs: number;

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
    const prompt = this.buildPromptFromMessages(messages);

    // Run CLI command
    const result = await this.runCLI(prompt);

    if (!result.ok) {
      return {
        content: `CLI error: ${result.error}`,
        finishReason: "error",
      };
    }

    // Parse output - CLI tools typically return plain text
    const content = this.stripReasoning(result.output);

    return {
      content,
      finishReason: "stop",
    };
  }

  private buildPromptFromMessages(messages: Message[]): string {
    const parts: string[] = [];

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
          args.push("prompt", prompt);
          break;
        case "codex":
          args.push("-q", prompt);
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
            error: "Command timed out",
          });
        } else {
          resolve({
            ok: code === 0,
            output: stdout,
            error: code !== 0 ? stderr || "Command failed" : undefined,
          });
        }
      });
    });
  }

  private stripReasoning(text: string): string {
    if (!text) return text;
    const endTag = "</think>";
    const idx = text.lastIndexOf(endTag);
    if (idx !== -1) {
      return text.slice(idx + endTag.length).trim();
    }
    return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  }

  async health(): Promise<boolean> {
    // Check if CLI binary exists
    return new Promise((resolve) => {
      const child = spawn(this.command, ["--version"], {
        env: process.env,
      });

      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });

      child.on("error", () => {
        clearTimeout(timer);
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
  private readonly baseUrl: string;
  private readonly model: string;
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
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
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

      // Check if error is retryable
      if (!isRetryableError(lastError) || attempt === opts.maxRetries) {
        throw lastError;
      }

      // Wait before retrying
      await sleep(delay);
      delay = Math.min(delay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: Error): boolean {
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

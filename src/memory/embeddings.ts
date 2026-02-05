/**
 * Embedding Generation
 * Phase 7: Memory System Redesign
 *
 * Multi-provider embedding support:
 * - Local providers (LM Studio - primary)
 * - OpenAI-compatible APIs
 * - Gemini (fallback)
 *
 * Features:
 * - Auto-detection with fallback
 * - Embedding caching
 * - Batch processing
 * - Provider health checking
 */

import crypto from "node:crypto";

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";

// Re-export interface from types for use in other modules
export type { EmbeddingProvider } from "./types.js";

/**
 * OpenClaw-compatible provider configuration
 */
export type OpenClawEmbeddingConfig = {
  provider: "auto" | "local" | "openai" | "gemini";
  fallback: Array<"local" | "openai" | "gemini">;
  local?: {
    baseUrl?: string;
    model?: string;
  };
  openai?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
  gemini?: {
    apiKey?: string;
    model?: string;
  };
  batch?: {
    enabled: boolean;
    minChunks: number;
    maxTokens: number;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMinutes: number;
  };
};

/**
 * Default batch size for embedding requests
 */
const DEFAULT_BATCH_SIZE = 64;

/**
 * In-memory embedding cache
 */
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();

/**
 * Maximum cache entries before cleanup
 */
const MAX_CACHE_ENTRIES = 10000;

/**
 * Cache TTL in milliseconds (1 hour)
 */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Create an embedding provider with auto-selection and fallback
 * 
 * Tries providers in order:
 * 1. Requested provider (if specific)
 * 2. Fallback providers (in order)
 * 
 * This allows LM Studio as primary, with OpenAI/Gemini as fallbacks
 */
export async function createEmbeddingProvider(config: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  type?: "openai" | "local";
  openClawConfig?: OpenClawEmbeddingConfig;
}): Promise<EmbeddingProvider> {
  // Legacy support: simple openai/local config
  if (config.type || (!config.openClawConfig && config.baseUrl)) {
    if (config.type === "local") {
      return new LocalEmbeddingProvider({
        baseUrl: config.baseUrl ?? "http://localhost:1234/v1",
        model: config.model ?? "text-embedding-model",
      });
    }
    return new OpenAIEmbeddingProvider({
      baseUrl: config.baseUrl ?? "http://localhost:1234/v1",
      apiKey: config.apiKey,
      model: config.model ?? "text-embedding-model",
    });
  }

  // OpenClaw-style multi-provider
  const cfg = config.openClawConfig ?? {
    provider: "auto",
    fallback: ["local", "openai"],
    local: { baseUrl: "http://localhost:1234/v1" },
  };

  if (!Array.isArray(cfg.fallback) || cfg.fallback.length === 0) {
    cfg.fallback = ["local", "openai"];
  }
  if (cfg.provider === "auto" && !cfg.fallback.includes("local")) {
    cfg.fallback = ["local", ...cfg.fallback];
  }

  // Try primary provider
  if (cfg.provider !== "auto") {
    try {
      return await tryProvider(cfg.provider, cfg);
    } catch (err) {
      // Fall through to fallback
      console.warn(`Primary embeddings provider '${cfg.provider}' failed:`, err);
    }
  }

  // Try fallback providers in order
  for (const fallbackProvider of cfg.fallback) {
    try {
      return await tryProvider(fallbackProvider, cfg);
    } catch (err) {
      console.warn(`Fallback embeddings provider '${fallbackProvider}' failed:`, err);
      // Continue to next fallback
    }
  }

  // All providers failed, return a stub that throws
  throw new Error(
    `No embedding provider available. Tried: ${cfg.provider}, ${cfg.fallback.join(", ")}`
  );
}

async function tryProvider(
  providerName: "local" | "openai" | "gemini",
  config: OpenClawEmbeddingConfig,
): Promise<EmbeddingProvider> {
  if (providerName === "local") {
    const localConfig = config.local ?? { baseUrl: "http://localhost:1234/v1" };
    return new LocalEmbeddingProvider({
      baseUrl: localConfig.baseUrl ?? "http://localhost:1234/v1",
      model: localConfig.model ?? "text-embedding-model",
    });
  }

  if (providerName === "openai") {
    const openaiConfig = config.openai ?? {};
    const apiKey = openaiConfig.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OpenAI API key not found");
    }
    return new OpenAIEmbeddingProvider({
      baseUrl: openaiConfig.baseUrl ?? "https://api.openai.com/v1",
      apiKey,
      model: openaiConfig.model ?? "text-embedding-3-small",
    });
  }

  if (providerName === "gemini") {
    const geminiConfig = config.gemini ?? {};
    const apiKey = geminiConfig.apiKey ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Gemini API key not found");
    }
    return new GeminiEmbeddingProvider({
      apiKey,
      model: geminiConfig.model ?? "models/embedding-001",
    });
  }

  throw new Error(`Unknown provider: ${providerName}`);
}

/**
 * OpenAI-compatible embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private model: string;
  private detectedDimension?: number;
  private autoSwitchedModel = false;

  constructor(config: { baseUrl: string; apiKey?: string; model: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += DEFAULT_BATCH_SIZE) {
      const batch = texts.slice(i, i + DEFAULT_BATCH_SIZE);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    // Detect dimension from first result
    if (results.length > 0 && results[0] && !this.detectedDimension) {
      this.detectedDimension = results[0].length;
    }

    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    // Check cache first
    const results: (number[] | null)[] = texts.map((text) => {
      const cached = getCachedEmbedding(text, this.model);
      return cached;
    });

    // Find uncached texts
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < results.length; i++) {
      if (results[i] === null) {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i] ?? "");
      }
    }

    // Fetch uncached embeddings
    if (uncachedTexts.length > 0) {
      const freshEmbeddings = await this.fetchEmbeddings(uncachedTexts);

      // Store in cache and results
      for (let i = 0; i < uncachedIndices.length; i++) {
        const idx = uncachedIndices[i]!;
        const embedding = freshEmbeddings[i] ?? [];
        results[idx] = embedding;
        setCachedEmbedding(uncachedTexts[i] ?? "", this.model, embedding);
      }
    }

    return results as number[][];
  }

  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const firstAttempt = await this.fetchEmbeddingsWithModel(texts, this.model);
    if (firstAttempt.ok) {
      return firstAttempt.embeddings;
    }

    const modelRejected = /not embedding/i.test(firstAttempt.body);
    if (!modelRejected || this.autoSwitchedModel) {
      throw new Error(`Embedding request failed: ${firstAttempt.status} ${firstAttempt.body}`);
    }

    const fallbackModel = await this.findFallbackEmbeddingModel();
    if (!fallbackModel || fallbackModel === this.model) {
      throw new Error(`Embedding request failed: ${firstAttempt.status} ${firstAttempt.body}`);
    }

    const previous = this.model;
    this.model = fallbackModel;
    this.autoSwitchedModel = true;
    console.warn(
      `Embedding model '${previous}' was rejected by server; switching to '${fallbackModel}'.`
    );

    const secondAttempt = await this.fetchEmbeddingsWithModel(texts, this.model);
    if (!secondAttempt.ok) {
      throw new Error(`Embedding request failed: ${secondAttempt.status} ${secondAttempt.body}`);
    }
    return secondAttempt.embeddings;
  }

  private async fetchEmbeddingsWithModel(
    texts: string[],
    model: string
  ): Promise<{ ok: true; embeddings: number[][] } | { ok: false; status: number; body: string }> {
    const url = new URL(this.baseUrl);
    if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    url.pathname += "embeddings";

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, status: response.status, body };
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };

    if (!data.data) {
      return { ok: true, embeddings: texts.map(() => []) };
    }

    // Sort by index to ensure correct order
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return { ok: true, embeddings: sorted.map((item) => normalizeEmbedding(item.embedding)) };
  }

  private async findFallbackEmbeddingModel(): Promise<string | null> {
    try {
      const url = new URL(this.baseUrl);
      if (!url.pathname.endsWith("/")) {
        url.pathname += "/";
      }
      url.pathname += "models";

      const headers: Record<string, string> = {};
      if (this.apiKey) {
        headers.authorization = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
      });
      if (!response.ok) return null;

      const data = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };
      const ids = (data.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      const candidates = ids.filter(
        (id) => id !== this.model && /embed|embedding/i.test(id)
      );
      if (candidates.length === 0) return null;

      const preferred =
        candidates.find((id) => /^text-embedding/i.test(id)) ??
        candidates.find((id) => /nomic/i.test(id)) ??
        candidates[0] ??
        null;
      return preferred;
    } catch {
      return null;
    }
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number | undefined {
    return this.detectedDimension;
  }
}

/**
 * Local embedding provider (e.g., LM Studio)
 */
export class LocalEmbeddingProvider extends OpenAIEmbeddingProvider {
  constructor(config: { baseUrl: string; model: string }) {
    super({
      baseUrl: config.baseUrl,
      apiKey: undefined, // Local providers typically don't need auth
      model: config.model,
    });
  }
}

/**
 * Gemini embedding provider (fallback)
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private detectedDimension?: number;

  constructor(config: { apiKey: string; model: string }) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    // Gemini has lower rate limits, so use smaller batches
    for (let i = 0; i < texts.length; i += 8) {
      const batch = texts.slice(i, i + 8);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    if (results.length > 0 && results[0] && !this.detectedDimension) {
      this.detectedDimension = results[0].length;
    }

    return results;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    // Check cache
    const results: (number[] | null)[] = texts.map((text) => {
      return getCachedEmbedding(text, this.model);
    });

    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < results.length; i++) {
      if (results[i] === null) {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i] ?? "");
      }
    }

    if (uncachedTexts.length > 0) {
      const freshEmbeddings = await this.fetchEmbeddings(uncachedTexts);
      for (let i = 0; i < uncachedIndices.length; i++) {
        const idx = uncachedIndices[i]!;
        const embedding = freshEmbeddings[i] ?? [];
        results[idx] = embedding;
        setCachedEmbedding(uncachedTexts[i] ?? "", this.model, embedding);
      }
    }

    return results as number[][];
  }

  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
        })),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini embedding failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      embeddings?: Array<{ values: number[] }>;
    };

    return (data.embeddings ?? []).map((e) =>
      normalizeEmbedding(e.values)
    );
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number | undefined {
    return this.detectedDimension;
  }
}

/**
 * Normalize embedding vector
 */
function normalizeEmbedding(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(
    sanitized.reduce((sum, v) => sum + v * v, 0)
  );
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((v) => v / magnitude);
}

/**
 * Generate cache key for text + model
 */
function cacheKey(text: string, model: string): string {
  const hash = crypto.createHash("sha256").update(`${model}:${text}`).digest("hex");
  return hash.slice(0, 32);
}

/**
 * Get cached embedding if available and not expired
 */
function getCachedEmbedding(text: string, model: string): number[] | null {
  const key = cacheKey(text, model);
  const entry = embeddingCache.get(key);

  if (!entry) return null;

  // Check if expired
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    embeddingCache.delete(key);
    return null;
  }

  return entry.embedding;
}

/**
 * Store embedding in cache
 */
function setCachedEmbedding(text: string, model: string, embedding: number[]): void {
  // Cleanup if cache is too large
  if (embeddingCache.size >= MAX_CACHE_ENTRIES) {
    cleanupCache();
  }

  const key = cacheKey(text, model);
  embeddingCache.set(key, {
    embedding,
    timestamp: Date.now(),
  });
}

/**
 * Remove expired and oldest entries from cache
 */
function cleanupCache(): void {
  const now = Date.now();
  const entries: Array<{ key: string; timestamp: number }> = [];

  // Collect entries and remove expired
  for (const [key, entry] of embeddingCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      embeddingCache.delete(key);
    } else {
      entries.push({ key, timestamp: entry.timestamp });
    }
  }

  // If still too large, remove oldest entries
  if (embeddingCache.size >= MAX_CACHE_ENTRIES * 0.9) {
    entries.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      const entry = entries[i];
      if (entry) {
        embeddingCache.delete(entry.key);
      }
    }
  }
}

/**
 * Clear the embedding cache
 */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/**
 * Get embedding cache statistics
 */
export function getEmbeddingCacheStats(): { size: number; maxSize: number } {
  return {
    size: embeddingCache.size,
    maxSize: MAX_CACHE_ENTRIES,
  };
}

/**
 * Compute cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Find top-k most similar embeddings
 */
export function findTopK(
  query: number[],
  candidates: Array<{ id: string; embedding: number[] }>,
  k: number,
  minScore = 0,
): Array<{ id: string; score: number }> {
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: cosineSimilarity(query, candidate.embedding),
    }))
    .filter((item) => Number.isFinite(item.score) && item.score >= minScore);

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}

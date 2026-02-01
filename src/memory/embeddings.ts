/**
 * Embedding Generation
 * Phase 7: Memory System Redesign
 *
 * Supports multiple embedding providers:
 * - OpenAI-compatible APIs
 * - Local models via LM Studio or similar
 *
 * Features:
 * - Batch embedding for efficiency
 * - Embedding caching to avoid recomputation
 */

import crypto from "node:crypto";

import type { EmbeddingProvider, EmbeddingProviderConfig } from "./types.js";

// Re-export interface from types for use in other modules
export type { EmbeddingProvider } from "./types.js";

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
 * Create an embedding provider from config
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  if (config.type === "local") {
    return new LocalEmbeddingProvider(config);
  }
  return new OpenAIEmbeddingProvider(config);
}

/**
 * OpenAI-compatible embedding provider
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly config: EmbeddingProviderConfig;
  private detectedDimension?: number;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
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
      const cached = getCachedEmbedding(text, this.config.model);
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
        setCachedEmbedding(uncachedTexts[i] ?? "", this.config.model, embedding);
      }
    }

    return results as number[][];
  }

  private async fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const baseUrl = this.config.baseUrl.replace(/\/$/, "");

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.config.apiKey) {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding request failed: ${response.status} ${text}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };

    if (!data.data) {
      return texts.map(() => []);
    }

    // Sort by index to ensure correct order
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  getModel(): string {
    return this.config.model;
  }

  getDimension(): number | undefined {
    return this.config.dimension ?? this.detectedDimension;
  }
}

/**
 * Local embedding provider (e.g., LM Studio)
 * Same API as OpenAI but typically no auth required
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly inner: OpenAIEmbeddingProvider;

  constructor(config: EmbeddingProviderConfig) {
    this.inner = new OpenAIEmbeddingProvider({
      ...config,
      // Local providers typically don't need API key
      apiKey: config.apiKey ?? undefined,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.inner.embed(texts);
  }

  getModel(): string {
    return this.inner.getModel();
  }

  getDimension(): number | undefined {
    return this.inner.getDimension();
  }
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

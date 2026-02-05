/**
 * Memory Manager - Phase 7 Complete Implementation
 *
 * Features:
 * - Hybrid search (vector + FTS5 keyword)
 * - Session transcript indexing with delta tracking
 * - Multi-provider embedding with fallback
 * - Token-based chunking with overlap
 * - Progress reporting
 * - Batch processing support
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import {
  buildFtsQuery,
  mergeHybridResults,
  bm25RankToScore,
  type HybridSearchResult,
} from "./hybrid.js";
import { chunkText, createMemoryChunks, estimateTokens } from "./chunker.js";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
  type OpenClawEmbeddingConfig,
} from "./embeddings.js";
import {
  createMemoryFileWatcher,
  FileWatcher,
  listMemoryFiles,
} from "./file-watcher.js";
import { SqliteStore } from "./sqlite-store.js";
import type {
  MemorySearchResult,
} from "./types.js";

// Re-export for backward compatibility
export type { MemorySearchResult } from "./types.js";

/**
 * Progress callback for memory operations
 */
export type MemoryProgressCallback = (progress: {
  completed: number;
  total: number;
  label?: string;
}) => void;

/**
 * Memory manager with all Phase 7 features
 */
export class MemoryManager {
  private readonly cfg: AntConfig;
  private readonly store: SqliteStore;
  private embedder: EmbeddingProvider | null = null;
  private embedderPromise: Promise<EmbeddingProvider> | null = null;
  private readonly embeddingConfig: OpenClawEmbeddingConfig;
  private fileWatcher?: FileWatcher;
  private sessionUpdateTimer?: NodeJS.Timeout;
  private progressCallback?: MemoryProgressCallback;
  private started = false;
  private embeddingsAvailable = true;
  private lastEmbeddingsCheckAt = 0;
  private nextEmbeddingsCheckAt = 0;
  private syncInFlight = false;
  private lastSyncAt = 0;
  private readonly sessionsDir: string;

  private static isLikelyLocalBaseUrl(raw?: string): boolean {
    if (!raw) return false;
    const value = raw.trim().toLowerCase();
    return value.includes("localhost") || value.includes("127.0.0.1") || value.includes("0.0.0.0");
  }

  constructor(cfg: AntConfig, progressCallback?: MemoryProgressCallback) {
    this.cfg = cfg;
    this.progressCallback = progressCallback;

    // Create SQLite store
    this.store = new SqliteStore(
      cfg.resolved.memorySqlitePath,
      cfg.memory.retentionDays ?? 30
    );
    this.sessionsDir = path.join(cfg.resolved.stateDir, "sessions");

    // Initialize embedding provider with multi-provider fallback
    const embeddingConfig: OpenClawEmbeddingConfig = {
      provider: (cfg.memory.provider?.embeddings ?? "auto") as
        | "auto"
        | "local"
        | "openai"
        | "gemini",
      fallback: cfg.memory.provider?.fallback ?? ["local", "openai"],
      local: cfg.memory.provider?.local ?? {
        baseUrl: "http://localhost:1234/v1",
      },
      openai: cfg.memory.provider?.openai,
      gemini: cfg.memory.provider?.gemini,
      batch: cfg.memory.provider?.batch,
    };

    if (embeddingConfig.local) {
      embeddingConfig.local.model ??= cfg.memory.embeddingsModel;
    }

    const routingEmbeddings = cfg.resolved.routing.embeddings ?? cfg.resolved.providers.default;
    const routingProvider = cfg.resolved.providers.items[routingEmbeddings];
    const routingBaseUrl = routingProvider?.baseUrl?.trim();
    const routingEmbeddingsModel =
      routingProvider?.embeddingsModel?.trim() || routingProvider?.model?.trim() || cfg.memory.embeddingsModel;

    const localFromRouting =
      routingProvider?.type === "openai" &&
      MemoryManager.isLikelyLocalBaseUrl(routingBaseUrl) &&
      !routingProvider?.apiKey;

    if (localFromRouting) {
      embeddingConfig.local = {
        ...(embeddingConfig.local ?? {}),
        baseUrl: routingBaseUrl || embeddingConfig.local?.baseUrl || "http://localhost:1234/v1",
        model: embeddingConfig.local?.model ?? routingEmbeddingsModel,
      };
      if (embeddingConfig.provider === "auto" || embeddingConfig.provider === "openai") {
        embeddingConfig.provider = "local";
      }
      if (!embeddingConfig.fallback.includes("local")) {
        embeddingConfig.fallback = ["local", ...embeddingConfig.fallback];
      }
    } else if (!embeddingConfig.openai?.baseUrl) {
      embeddingConfig.openai ??= {
        baseUrl: routingBaseUrl,
        apiKey: routingProvider?.apiKey,
        model: routingEmbeddingsModel,
      };
    } else {
      embeddingConfig.openai.model ??= cfg.memory.embeddingsModel;
    }

    this.embeddingConfig = embeddingConfig;
  }

  private async getEmbedder(): Promise<EmbeddingProvider | null> {
    if (this.embedder) return this.embedder;
    if (!this.embedderPromise) {
      this.embedderPromise = createEmbeddingProvider({ openClawConfig: this.embeddingConfig });
    }
    try {
      this.embedder = await this.embedderPromise;
      return this.embedder;
    } catch (err) {
      this.embedderPromise = null;
      this.embeddingsAvailable = false;
      this.nextEmbeddingsCheckAt = Date.now() + 60_000;
      console.warn("Embedding provider initialization failed:", err);
      return null;
    }
  }

  /**
   * Start the memory system
   */
  async start(): Promise<void> {
    if (!this.cfg.memory.enabled) {
      this.started = true;
      return;
    }

    try {
      const embeddingsOk = await this.ensureEmbeddingsAvailable("startup");
      if (!embeddingsOk) {
        this.embeddingsAvailable = false;
        console.warn(
          "Embeddings endpoint unavailable. Memory indexing will skip embeddings until it recovers."
        );
      }

      // Start file watcher if enabled
      if (this.cfg.memory.sync.watch) {
        this.fileWatcher = createMemoryFileWatcher(
          this.cfg.resolved.workspaceDir,
          async (filePath) => {
            await this.indexFile(filePath, "memory");
          },
          this.cfg.memory.sync.watchDebounceMs
        );
        await this.fileWatcher.start();
      }

      // Initial indexing if configured
      if (this.cfg.memory.sync.onSessionStart) {
        await this.indexAll();
      }

      const intervalMinutes = this.cfg.memory.sync.intervalMinutes ?? 0;
      if (intervalMinutes > 0) {
        const intervalMs = intervalMinutes * 60 * 1000;
        this.sessionUpdateTimer = setInterval(() => {
          void this.syncIfNeeded("interval");
        }, intervalMs);
        this.sessionUpdateTimer.unref();
      }
      this.started = true;
    } catch (err) {
      console.warn("Memory system startup warning:", err);
      this.started = false;
      // Don't fail - memory is optional
    }
  }

  /**
   * Stop the memory system
   */
  stop(): void {
    this.fileWatcher?.stop();
    if (this.sessionUpdateTimer) {
      clearTimeout(this.sessionUpdateTimer);
    }
    this.store.close();
    this.started = false;
  }

  applyQueryHotReload(next: AntConfig["memory"]["query"]): void {
    this.cfg.memory.query = next;
  }

  isReady(): boolean {
    if (!this.cfg.memory.enabled) return true;
    return this.started;
  }

  /**
   * Hybrid search - combines vector and keyword search
   *
   * Returns top-k results ranked by:
   * vectorScore * vectorWeight + textScore * textWeight
   */
  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sourceFilter?: Array<"memory" | "sessions">;
    }
  ): Promise<MemorySearchResult[]> {
    if (!this.cfg.memory.enabled) return [];

    const maxResults = opts?.maxResults ?? this.cfg.memory.query.maxResults;
    const minScore = opts?.minScore ?? this.cfg.memory.query.minScore;
    const hybrid = this.cfg.memory.query.hybrid;
    const sources = opts?.sourceFilter ?? this.cfg.memory.sources;

    // Ensure sync before search if configured
    if (this.cfg.memory.sync.onSearch) {
      await this.syncIfNeeded("search");
    }

    if (!hybrid.enabled) {
      // Vector-only search
      return this.searchVector(query, maxResults, minScore, sources);
    }

    // Hybrid search: vector + keyword
    const candidates = Math.min(
      200,
      Math.max(1, Math.floor(maxResults * hybrid.candidateMultiplier))
    );

    // Run both searches in parallel
    const [vectorResults, keywordResults] = await Promise.all([
      this.searchVector(query, candidates, 0, sources), // Get more candidates
      this.searchKeyword(query, candidates, sources),
    ]);

    // Merge and re-rank by weighted score
    const merged = mergeHybridResults({
      vector: vectorResults.map((r) => ({
        id: r.chunkId,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: r.score,
      })),
      keyword: keywordResults,
      vectorWeight: hybrid.vectorWeight,
      textWeight: hybrid.textWeight,
    });

    return merged
      .filter((r) => r.score >= minScore)
      .slice(0, maxResults)
      .map((r) => ({
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.score,
        snippet: r.snippet,
        source: r.source as "memory" | "sessions",
        chunkId: r.id,
      }));
  }

  /**
   * Vector search only
   */
  private async searchVector(
    query: string,
    limit: number,
    minScore: number,
    sources?: Array<"memory" | "sessions">
  ): Promise<MemorySearchResult[]> {
    // Generate query embedding
    try {
      const embedder = await this.getEmbedder();
      if (!embedder) return [];
      const embeddings = await embedder.embed([query]);
      const queryEmbedding = embeddings[0];
      if (!queryEmbedding || queryEmbedding.length === 0) return [];

      // Vector search in store
      const storeResults = this.store.searchSimilar(
        queryEmbedding,
        limit,
        minScore,
        sources
      );

      this.store.markChunksAccessed(storeResults.map((r) => r.chunk.id));

      return storeResults.map((r) => ({
        path: r.chunk.path,
        startLine: r.chunk.startLine,
        endLine: r.chunk.endLine,
        score: r.score,
        snippet: r.chunk.text.slice(0, 700),
        source: r.chunk.source,
        chunkId: r.chunk.id,
        category: r.chunk.category,
        priority: r.chunk.priority,
        accessCount: r.chunk.accessCount,
        lastAccessedAt: r.chunk.lastAccessedAt,
      }));
    } catch (err) {
      console.warn("Vector search failed:", err);
      return [];
    }
  }

  /**
   * Keyword search using FTS5
   */
  private async searchKeyword(
    query: string,
    limit: number,
    sources?: Array<"memory" | "sessions">
  ): Promise<
    Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: string;
      snippet: string;
      textScore: number;
    }>
  > {
    if (!this.store.isFtsAvailable()) {
      return [];
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const results = this.store.searchKeyword(ftsQuery, limit);

      // Filter by source if specified
      const filtered = sources
        ? results.filter((r) =>
            sources.includes(r.source as "memory" | "sessions")
          )
        : results;

      this.store.markChunksAccessed(filtered.map((r) => r.id));

      return filtered;
    } catch (err) {
      console.warn("Keyword search failed:", err);
      return [];
    }
  }

  /**
   * Index all memory sources
   */
  async indexAll(progress?: MemoryProgressCallback): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    const progressCb = progress || this.progressCallback;

    // Index memory files
    const sources = this.cfg.memory.sources ?? ["memory"];
    let total = 0;

    if (sources.includes("memory")) {
      await this.indexMemoryFiles(progressCb);
    }

    if (sources.includes("sessions") && this.cfg.memory.indexSessions) {
      await this.indexSessionTranscripts(progressCb);
    }

    // Cleanup and optimize
    this.store.cleanupOldSessions();
    this.store.vacuum();
  }

  /**
   * Index memory files (MEMORY.md, memory/*.md)
   */
  private async indexMemoryFiles(
    progress?: MemoryProgressCallback
  ): Promise<void> {
    try {
      const files = await listMemoryFiles(this.cfg.resolved.workspaceDir);

      if (progress) {
        progress({ completed: 0, total: files.length, label: "Indexing memory files…" });
      }

      for (let i = 0; i < files.length; i++) {
        const filePath = files[i]!.path;
        await this.indexFile(filePath, "memory");

        if (progress) {
          progress({
            completed: i + 1,
            total: files.length,
            label: `Indexing ${path.basename(filePath)}…`,
          });
        }
      }
    } catch (err) {
      console.warn("Memory file indexing error:", err);
    }
  }

  /**
   * Index session transcripts
   */
  private async indexSessionTranscripts(
    progress?: MemoryProgressCallback
  ): Promise<void> {
    try {
      const files = await fs.readdir(this.sessionsDir);

      if (progress) {
        progress({
          completed: 0,
          total: files.length,
          label: "Indexing sessions…",
        });
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        if (!file.endsWith(".jsonl")) continue;

        const filePath = path.join(this.sessionsDir, file);

        // Check delta - only re-index if threshold exceeded
        const shouldIndex = await this.checkSessionDelta(filePath);
        if (shouldIndex) {
          await this.indexFile(filePath, "sessions");
          await this.updateSessionDelta(filePath, { indexed: true });
        } else {
          await this.updateSessionDelta(filePath, { indexed: false });
        }

        if (progress) {
          progress({
            completed: i + 1,
            total: files.length,
            label: `Indexing session ${file}…`,
          });
        }
      }
    } catch (err) {
      console.warn("Session indexing error:", err);
    }
  }

  /**
   * Check if session file should be re-indexed based on delta
   */
  private getSessionDeltaKey(filePath: string): string {
    return path.resolve(filePath);
  }

  private async checkSessionDelta(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      const key = this.getSessionDeltaKey(filePath);
      const current = this.store.getSessionDelta(key) ?? {
        lastSize: 0,
        pendingBytes: 0,
        pendingMessages: 0,
      };

      const deltaBytes = this.cfg.memory.sync.sessions?.deltaBytes ?? 100_000;
      const deltaMessages = this.cfg.memory.sync.sessions?.deltaMessages ?? 50;

      const sizeDelta = stat.size - current.lastSize;
      if (sizeDelta < 0) {
        return true;
      }

      const newMessages = await this.countNewMessages(filePath, current.lastSize);
      const pendingBytes = current.pendingBytes + sizeDelta;
      const pendingMessages = current.pendingMessages + newMessages;

      return pendingBytes >= deltaBytes || pendingMessages >= deltaMessages || current.lastSize === 0;
    } catch {
      return false;
    }
  }

  private async updateSessionDelta(
    filePath: string,
    params: { indexed: boolean }
  ): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      const key = this.getSessionDeltaKey(filePath);
      const current = this.store.getSessionDelta(key) ?? {
        lastSize: 0,
        pendingBytes: 0,
        pendingMessages: 0,
      };

      const sizeDelta = Math.max(0, stat.size - current.lastSize);
      const newMessages = await this.countNewMessages(filePath, current.lastSize);

      if (params.indexed) {
        this.store.updateSessionDelta(key, {
          lastSize: stat.size,
          pendingBytes: 0,
          pendingMessages: 0,
        });
        return;
      }

      this.store.updateSessionDelta(key, {
        pendingBytes: current.pendingBytes + sizeDelta,
        pendingMessages: current.pendingMessages + newMessages,
      });
    } catch {
      // ignore
    }
  }

  /**
   * Count new messages in session file
   */
  private async countNewMessages(filePath: string, fromByte: number): Promise<number> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const newContent = content.slice(fromByte);
      return newContent.split("\n").filter((line) => line.trim()).length;
    } catch {
      return 0;
    }
  }

  private async readIndexableContent(
    filePath: string,
    source: "memory" | "sessions"
  ): Promise<{ content: string; fileHash: string; lineCount: number }> {
    if (source === "sessions") {
      const sessionContent = await this.readSessionTranscript(filePath);
      const fileHash = crypto.createHash("sha256").update(sessionContent).digest("hex");
      const lineCount = sessionContent.split("\n").filter(Boolean).length;
      return { content: sessionContent, fileHash, lineCount };
    }

    const content = await fs.readFile(filePath, "utf-8");
    const fileHash = crypto.createHash("sha256").update(content).digest("hex");
    const lineCount = content.split("\n").length;
    return { content, fileHash, lineCount };
  }

  private async readSessionTranscript(filePath: string): Promise<string> {
    const raw = await fs.readFile(filePath, "utf-8");
    const cfg = this.cfg.memory.sessions;
    let slice = raw;

    if (cfg.maxBytes && slice.length > cfg.maxBytes) {
      slice = slice.slice(-cfg.maxBytes);
      const firstNewline = slice.indexOf("\n");
      if (firstNewline >= 0) {
        slice = slice.slice(firstNewline + 1);
      }
    }

    let lines = slice.split("\n").filter(Boolean);
    if (cfg.maxMessages && lines.length > cfg.maxMessages) {
      lines = lines.slice(-cfg.maxMessages);
    }

    const includeRoles = new Set(
      (cfg.includeRoles ?? ["user", "assistant"]).map((role) => role.toLowerCase())
    );
    const minChars = cfg.minChars ?? 1;
    const excludePatterns = this.compileExcludePatterns(cfg.excludePatterns ?? []);

    const output: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { role?: unknown; content?: unknown; name?: unknown } | null;
        if (!parsed || typeof parsed !== "object") continue;
        const role = typeof parsed.role === "string" ? parsed.role.toLowerCase() : "message";
        if (!includeRoles.has(role)) continue;
        const contentValue = (parsed as any).content;
        const content = typeof contentValue === "string" ? contentValue : String(contentValue ?? "");
        const trimmed = content.trim();
        if (trimmed.length < minChars) continue;
        const name = typeof (parsed as any).name === "string" ? (parsed as any).name : undefined;
        const rendered = `${role}${name ? `(${name})` : ""}: ${trimmed}`;
        if (this.matchesExcludePatterns(rendered, excludePatterns)) continue;
        output.push(rendered);
      } catch {
        // ignore malformed lines
      }
    }

    return output.join("\n");
  }

  private compileExcludePatterns(patterns: string[]): Array<RegExp | string> {
    return patterns.map((pattern) => {
      const trimmed = pattern.trim();
      if (!trimmed) return "";
      try {
        return new RegExp(trimmed, "i");
      } catch {
        return trimmed;
      }
    }).filter((pattern) => pattern !== "");
  }

  private matchesExcludePatterns(text: string, patterns: Array<RegExp | string>): boolean {
    for (const pattern of patterns) {
      if (!pattern) continue;
      if (typeof pattern === "string") {
        if (text.toLowerCase().includes(pattern.toLowerCase())) return true;
        continue;
      }
      if (pattern.test(text)) return true;
    }
    return false;
  }

  /**
   * Index a single file
   */
  private async indexFile(
    filePath: string,
    source: "memory" | "sessions"
  ): Promise<void> {
    try {
      const { content, fileHash, lineCount } = await this.readIndexableContent(filePath, source);
      if (!content.trim()) return;
      const relPath = path.relative(this.cfg.resolved.workspaceDir, filePath);

      // Check if file needs re-indexing
      const existing = this.store.getFile(relPath);
      if (existing?.hash === fileHash) {
        return; // Already indexed
      }

      // Chunk the content - use token-based sizes from config
      const chunkTokens = this.cfg.memory.chunking?.tokens ?? 400;
      const chunkOverlapTokens = this.cfg.memory.chunking?.overlap ?? 80;

      const textChunks = chunkText(content, {
        chunkSize: chunkTokens * 4, // ~chars per token
        overlap: chunkOverlapTokens * 4,
        preserveMarkdown: true,
      });

      const chunks = createMemoryChunks(
        textChunks,
        relPath,
        source,
        fileHash
      );

      if (chunks.length === 0) return;

      // Update file metadata first (required for FK on chunks.path)
      this.store.upsertFile(
        chunks[0]?.path ?? relPath,
        source,
        fileHash,
        content.length,
        lineCount
      );

      // Store chunks
      this.store.storeChunks(chunks[0]?.path ?? relPath, chunks);

      // Generate embeddings (best-effort)
      try {
        const ok = await this.ensureEmbeddingsAvailable("index");
        if (ok) {
          const embedder = await this.getEmbedder();
          if (!embedder) {
            this.embeddingsAvailable = false;
            this.nextEmbeddingsCheckAt = Date.now() + 60_000;
          } else {
            const embeddings = await embedder.embed(chunks.map((c) => c.text));
            if (embeddings.length === chunks.length) {
              const valid = chunks
                .map((chunk, i) => ({
                  chunkId: chunk.id,
                  embedding: embeddings[i] ?? [],
                  model: embedder.getModel(),
                }))
                .filter((item) => Array.isArray(item.embedding) && item.embedding.length > 0);

              if (valid.length > 0) {
                this.store.storeEmbeddings(valid);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`Embedding error for ${filePath}:`, err);
        this.embeddingsAvailable = false;
        this.nextEmbeddingsCheckAt = Date.now() + 60_000;
      }

      // Index in FTS5 if available
      for (const chunk of chunks) {
        this.store.indexChunkFts(chunk);
      }

    } catch (err) {
      console.warn(`Failed to index ${filePath}:`, err);
    }
  }

  private async ensureEmbeddingsAvailable(reason: "startup" | "index"): Promise<boolean> {
    if (!this.cfg.memory.enabled) return false;
    if (this.embeddingsAvailable && !(reason === "startup" && this.lastEmbeddingsCheckAt === 0)) {
      return true;
    }

    const now = Date.now();
    if (now < this.nextEmbeddingsCheckAt) return false;
    this.lastEmbeddingsCheckAt = now;

    try {
      const embedder = await this.getEmbedder();
      if (!embedder) {
        this.embeddingsAvailable = false;
      } else {
        const provider = embedder as EmbeddingProvider & { health?: () => Promise<boolean> };
        if (typeof provider.health === "function") {
          const ok = await provider.health();
          this.embeddingsAvailable = ok;
        } else {
          const test = await embedder.embed(["ping"]);
          this.embeddingsAvailable = Array.isArray(test) && test.length === 1 && test[0]?.length > 0;
        }
      }
    } catch {
      this.embeddingsAvailable = false;
    }

    if (!this.embeddingsAvailable) {
      this.nextEmbeddingsCheckAt = now + (reason === "startup" ? 30_000 : 60_000);
    }

    return this.embeddingsAvailable;
  }

  /**
   * Sync if needed (check dirty flag)
   */
  private async syncIfNeeded(reason: "search" | "interval"): Promise<void> {
    if (!this.cfg.memory.enabled) return;
    if (this.syncInFlight) return;

    const intervalMinutes = this.cfg.memory.sync.intervalMinutes ?? 0;
    const intervalMs = intervalMinutes > 0 ? intervalMinutes * 60 * 1000 : 0;
    const now = Date.now();

    if (reason === "interval" && intervalMs > 0 && now - this.lastSyncAt < intervalMs) {
      return;
    }

    this.syncInFlight = true;
    try {
      if (reason === "search") {
        if (this.cfg.memory.sources.includes("sessions") && this.cfg.memory.indexSessions) {
          await this.indexSessionTranscripts();
        }
        if (!this.cfg.memory.sync.watch && this.cfg.memory.sources.includes("memory")) {
          await this.indexMemoryFiles();
        }
      } else {
        await this.indexAll();
      }
      this.lastSyncAt = Date.now();
    } catch (err) {
      console.warn("Memory sync failed:", err);
    } finally {
      this.syncInFlight = false;
    }
  }

  getMemoryStats(): {
    enabled: boolean;
    fileCount: number;
    chunkCount: number;
    totalTextBytes: number;
    categories: Record<string, number>;
  } {
    if (!this.cfg.memory.enabled) {
      return { enabled: false, fileCount: 0, chunkCount: 0, totalTextBytes: 0, categories: {} };
    }
    const stats = this.store.getMemoryStats();
    return { enabled: true, ...stats };
  }

  listMemoryChunks(params?: {
    limit?: number;
    offset?: number;
    category?: string;
    source?: "memory" | "sessions" | "short-term";
  }) {
    if (!this.cfg.memory.enabled) return [];
    return this.store.listChunks(params);
  }

  countMemoryChunks(params?: { category?: string; source?: "memory" | "sessions" | "short-term" }): number {
    if (!this.cfg.memory.enabled) return 0;
    return this.store.countChunks(params);
  }

  /**
   * Add content to memory (recall/remember feature)
   */
  async update(content: string): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    try {
      const memoryDir = path.join(
        this.cfg.resolved.workspaceDir,
        "memory"
      );
      await fs.mkdir(memoryDir, { recursive: true });

      const dynamicPath = path.join(memoryDir, "dynamic.md");
      const timestamp = new Date().toISOString();
      const entry = `\n---\n[${timestamp}] Memory Update\n\n${content}\n`;

      await fs.appendFile(dynamicPath, entry, "utf-8");
      await this.indexFile(dynamicPath, "memory");
    } catch (err) {
      console.warn("Failed to update memory:", err);
    }
  }
}

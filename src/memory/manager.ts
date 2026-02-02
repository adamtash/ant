/**
 * Memory Manager
 * Phase 7: Memory System Redesign
 *
 * Multi-tier memory architecture:
 * - Tier 1 (Short-term): Current session in RAM, last 5 sessions cached
 * - Tier 2 (Medium-term): SQLite index, session transcripts past 30 days
 * - Tier 3 (Long-term): MEMORY.md, memory/*.md files
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import { chunkText, createMemoryChunks } from "./chunker.js";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.js";
import { createMemoryFileWatcher, FileWatcher, listMemoryFiles } from "./file-watcher.js";
import { SqliteStore } from "./sqlite-store.js";
import type {
  EmbeddingProviderConfig,
  MemorySearchResult,
  MemorySyncState,
  ReadFileParams,
  ReadFileResult,
  ShortTermMessage,
  ShortTermSession,
} from "./types.js";

/**
 * Default configuration values
 */
const DEFAULTS = {
  SHORT_TERM_CACHED_SESSIONS: 5,
  SHORT_TERM_MAX_AGE_MINUTES: 60,
  MEDIUM_TERM_RETENTION_DAYS: 30,
};

/**
 * Legacy OpenAI client interface for backward compatibility
 */
interface LegacyOpenAIClient {
  embed(params: { model: string; input: string[] }): Promise<{ embeddings: number[][] }>;
}

/**
 * Wrapper to adapt legacy client to EmbeddingProvider interface
 */
class LegacyEmbeddingProviderAdapter implements EmbeddingProvider {
  private readonly client: LegacyOpenAIClient;
  private readonly model: string;

  constructor(client: LegacyOpenAIClient, model: string) {
    this.client = client;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const result = await this.client.embed({ model: this.model, input: texts });
    return result.embeddings;
  }

  getModel(): string {
    return this.model;
  }

  getDimension(): number | undefined {
    return undefined;
  }
}

/**
 * Constructor params - supports both new and legacy signatures
 */
type MemoryManagerParams = {
  cfg: AntConfig;
  embeddingProvider?: EmbeddingProvider;
  embeddingConfig?: EmbeddingProviderConfig;
  // Legacy parameters for backward compatibility
  client?: LegacyOpenAIClient;
  embeddingModel?: string;
};

/**
 * Main memory manager with multi-tier architecture
 */
export class MemoryManager {
  private readonly cfg: AntConfig;
  private readonly store: SqliteStore;
  private readonly embedder: EmbeddingProvider;
  private readonly syncStatePath: string;
  private syncState: MemorySyncState;

  // Tier 1: Short-term memory
  private readonly shortTermSessions = new Map<string, ShortTermSession>();
  private readonly shortTermOrder: string[] = []; // LRU order

  // File watcher for Tier 3
  private fileWatcher?: FileWatcher;

  constructor(params: MemoryManagerParams) {
    this.cfg = params.cfg;
    this.store = new SqliteStore(
      params.cfg.resolved.memorySqlitePath,
      DEFAULTS.MEDIUM_TERM_RETENTION_DAYS,
    );

    // Create embedding provider - support both new and legacy signatures
    if (params.embeddingProvider) {
      this.embedder = params.embeddingProvider;
    } else if (params.client && params.embeddingModel) {
      // Legacy: wrap OpenAIClient in adapter
      this.embedder = new LegacyEmbeddingProviderAdapter(params.client, params.embeddingModel);
    } else if (params.embeddingConfig) {
      this.embedder = createEmbeddingProvider(params.embeddingConfig);
    } else {
      // Default to OpenAI-compatible provider using config
      const defaultProvider = params.cfg.resolved.providers.items[params.cfg.resolved.providers.default];
      this.embedder = createEmbeddingProvider({
        type: "openai",
        baseUrl: defaultProvider?.baseUrl ?? "http://localhost:1234/v1",
        apiKey: defaultProvider?.apiKey,
        model: params.cfg.resolved.providerEmbeddingsModel,
      });
    }

    this.syncStatePath = path.join(params.cfg.resolved.stateDir, "memory-sync.json");
    this.syncState = { files: {}, lastRunAt: 0 };
  }

  /**
   * Start the memory system (including file watcher)
   */
  async start(): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    // Load sync state
    await this.loadSyncState();

    // Start file watcher if enabled
    if (this.cfg.memory.sync.watch) {
      this.fileWatcher = createMemoryFileWatcher(
        this.cfg.resolved.workspaceDir,
        async (filePath) => {
          await this.indexFile(filePath, "memory");
        },
        this.cfg.memory.sync.watchDebounceMs,
      );
      await this.fileWatcher.start();
    }

    // Initial sync if configured
    if (this.cfg.memory.sync.onSessionStart) {
      await this.indexAll();
    }
  }

  /**
   * Stop the memory system
   */
  stop(): void {
    this.fileWatcher?.stop();
    this.store.close();
  }

  /**
   * Search memory for relevant context
   */
  async search(
    query: string,
    maxResults?: number,
    minScore?: number,
  ): Promise<MemorySearchResult[]> {
    if (!this.cfg.memory.enabled) return [];

    // Sync if configured
    if (this.cfg.memory.sync.onSearch) {
      await this.syncIfNeeded("search");
    }

    const limit = maxResults ?? this.cfg.memory.maxResults;
    const threshold = minScore ?? this.cfg.memory.minScore;

    // Generate query embedding
    const queryEmbeddings = await this.embedder.embed([query]);
    const queryEmbedding = queryEmbeddings[0];
    if (!queryEmbedding || queryEmbedding.length === 0) return [];

    // Search Tier 1: Short-term memory
    const shortTermResults = this.searchShortTerm(queryEmbedding, limit, threshold);

    // Search Tier 2 & 3: SQLite store (medium + long term)
    const storeResults = this.store.searchSimilar(
      queryEmbedding,
      limit,
      threshold,
    );

    // Combine and deduplicate results
    const combined = [
      ...shortTermResults.map((r) => ({
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.score,
        snippet: r.text,
        source: "short-term" as const,
        chunkId: r.id,
      })),
      ...storeResults.map((r) => ({
        path: r.chunk.path,
        startLine: r.chunk.startLine,
        endLine: r.chunk.endLine,
        score: r.score,
        snippet: r.chunk.text,
        source: r.chunk.source,
        chunkId: r.chunk.id,
      })),
    ];

    // Sort by score and limit
    combined.sort((a, b) => b.score - a.score);
    return combined.slice(0, limit);
  }

  /**
   * Get relevant context for a session (recall)
   */
  async recall(sessionKey: string): Promise<string[]> {
    if (!this.cfg.memory.enabled) return [];

    // Get recent messages from the session
    const session = this.shortTermSessions.get(sessionKey);
    if (!session || session.messages.length === 0) return [];

    // Build a query from recent user messages
    const recentUserMessages = session.messages
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content)
      .join(" ");

    if (!recentUserMessages.trim()) return [];

    // Search for relevant context
    const results = await this.search(recentUserMessages, 5, 0.4);

    return results.map((r) => `[${r.source}:${r.path}:${r.startLine}-${r.endLine}]\n${r.snippet}`);
  }

  /**
   * Add content to memory
   */
  async update(content: string, source = "dynamic"): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    // For dynamic updates, add to a special dynamic memory file
    const dynamicPath = path.join(this.cfg.resolved.workspaceDir, "memory", "dynamic.md");

    // Ensure memory directory exists
    const memoryDir = path.join(this.cfg.resolved.workspaceDir, "memory");
    await fs.mkdir(memoryDir, { recursive: true });

    // Append to dynamic memory file
    const timestamp = new Date().toISOString();
    const entry = `\n---\n[${timestamp}] ${source}\n\n${content}\n`;

    await fs.appendFile(dynamicPath, entry, "utf-8");

    // Re-index the file
    await this.indexFile(dynamicPath, "memory");
  }

  /**
   * Re-index all memory sources
   */
  async indexAll(): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    // Index Tier 3: Long-term memory files
    await this.indexMemoryFiles();

    // Index Tier 2: Session transcripts
    if (this.cfg.memory.indexSessions) {
      await this.indexSessionTranscripts();
    }

    // Cleanup old sessions
    this.store.cleanupOldSessions();

    // Persist sync state
    await this.persistSyncState();
  }

  /**
   * Read a file from memory or sessions
   */
  async readFile(params: ReadFileParams): Promise<ReadFileResult> {
    const rel = params.relPath.replace(/^\/+/, "");

    // Determine base directory
    const isSession = rel.startsWith("sessions/");
    const base = isSession
      ? path.join(this.cfg.resolved.stateDir, "sessions")
      : this.cfg.resolved.workspaceDir;

    const filePath = path.join(base, rel.replace(/^sessions\//, ""));

    const raw = await fs.readFile(filePath, "utf-8");
    const allLines = raw.split("\n");

    const from = params.from && params.from > 0 ? params.from - 1 : 0;
    const lines = params.lines && params.lines > 0 ? params.lines : allLines.length;
    const slice = allLines.slice(from, from + lines);

    return { path: rel, text: slice.join("\n") };
  }

  /**
   * Add a message to short-term memory for a session
   */
  addToShortTerm(sessionKey: string, message: ShortTermMessage): void {
    let session = this.shortTermSessions.get(sessionKey);

    if (!session) {
      session = {
        sessionKey,
        messages: [],
        lastActivityAt: Date.now(),
      };
      this.shortTermSessions.set(sessionKey, session);
      this.shortTermOrder.push(sessionKey);
    }

    session.messages.push(message);
    session.lastActivityAt = Date.now();

    // Move to end of LRU order
    const idx = this.shortTermOrder.indexOf(sessionKey);
    if (idx >= 0) {
      this.shortTermOrder.splice(idx, 1);
    }
    this.shortTermOrder.push(sessionKey);

    // Evict old sessions if needed
    this.evictShortTermIfNeeded();
  }

  /**
   * Get short-term session data
   */
  getShortTermSession(sessionKey: string): ShortTermSession | undefined {
    return this.shortTermSessions.get(sessionKey);
  }

  /**
   * Clear short-term memory for a session
   */
  clearShortTerm(sessionKey: string): void {
    this.shortTermSessions.delete(sessionKey);
    const idx = this.shortTermOrder.indexOf(sessionKey);
    if (idx >= 0) {
      this.shortTermOrder.splice(idx, 1);
    }
  }

  /**
   * Get memory system statistics
   */
  getStats(): {
    shortTermSessions: number;
    storeStats: ReturnType<SqliteStore["getStats"]>;
  } {
    return {
      shortTermSessions: this.shortTermSessions.size,
      storeStats: this.store.getStats(),
    };
  }

  // ============================================
  // Private methods
  // ============================================

  /**
   * Search short-term memory
   */
  private searchShortTerm(
    queryEmbedding: number[],
    maxResults: number,
    minScore: number,
  ): Array<{ id: string; path: string; startLine: number; endLine: number; text: string; score: number }> {
    const results: Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      score: number;
    }> = [];

    // For now, we'll do a simple text-based search on short-term memory
    // A full implementation would embed the messages and compute similarity
    // This is a placeholder that returns empty results
    // Full implementation would:
    // 1. Chunk recent messages
    // 2. Compute embeddings (cached per session)
    // 3. Compute similarity scores

    return results.slice(0, maxResults);
  }

  /**
   * Evict oldest short-term sessions if over limit
   */
  private evictShortTermIfNeeded(): void {
    const maxSessions = DEFAULTS.SHORT_TERM_CACHED_SESSIONS;
    const maxAgeMs = DEFAULTS.SHORT_TERM_MAX_AGE_MINUTES * 60 * 1000;
    const now = Date.now();

    // Remove expired sessions
    for (const [key, session] of this.shortTermSessions.entries()) {
      if (now - session.lastActivityAt > maxAgeMs) {
        this.shortTermSessions.delete(key);
        const idx = this.shortTermOrder.indexOf(key);
        if (idx >= 0) {
          this.shortTermOrder.splice(idx, 1);
        }
      }
    }

    // Remove oldest if over limit
    while (this.shortTermOrder.length > maxSessions) {
      const oldest = this.shortTermOrder.shift();
      if (oldest) {
        this.shortTermSessions.delete(oldest);
      }
    }
  }

  /**
   * Index all memory files (Tier 3)
   */
  private async indexMemoryFiles(): Promise<void> {
    const memoryFiles = await listMemoryFiles(this.cfg.resolved.workspaceDir);

    for (const entry of memoryFiles) {
      await this.indexFile(entry.path, "memory", entry.relativePath);
    }
  }

  /**
   * Index session transcripts (Tier 2)
   */
  private async indexSessionTranscripts(): Promise<void> {
    const sessionsDir = path.join(this.cfg.resolved.stateDir, "sessions");

    let entries: string[] = [];
    try {
      entries = await fs.readdir(sessionsDir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (!name.endsWith(".jsonl")) continue;

      const filePath = path.join(sessionsDir, name);
      const relPath = `sessions/${name}`;

      // Check if needs indexing
      const shouldIndex = await this.shouldIndexSessionFile(filePath, relPath);
      if (!shouldIndex) continue;

      await this.indexFile(filePath, "sessions", relPath);
    }
  }

  /**
   * Check if a session file needs re-indexing
   */
  private async shouldIndexSessionFile(absPath: string, relPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(absPath);
      const prev = this.syncState.files[relPath];

      if (!prev) return true;

      // Check size delta
      const deltaBytes = Math.max(0, stats.size - prev.size);
      if (deltaBytes >= this.cfg.memory.sync.sessionsDeltaBytes) return true;

      // Check message delta
      if (this.cfg.memory.sync.sessionsDeltaMessages <= 0) return false;

      const raw = await fs.readFile(absPath, "utf-8");
      const lines = raw.split("\n").filter(Boolean).length;
      const deltaLines = Math.max(0, lines - (prev.lines ?? 0));

      return deltaLines >= this.cfg.memory.sync.sessionsDeltaMessages;
    } catch {
      return false;
    }
  }

  /**
   * Index a single file
   */
  private async indexFile(
    absPath: string,
    source: "memory" | "sessions",
    relOverride?: string,
  ): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(absPath, "utf-8");
    } catch {
      return;
    }

    const hash = sha256(raw);
    const relPath = relOverride ?? path.relative(this.cfg.resolved.workspaceDir, absPath);

    // Check if already indexed with same hash
    if (!this.store.fileNeedsUpdate(relPath, hash)) {
      return;
    }

    // Chunk the text
    const textChunks = chunkText(raw, {
      chunkSize: this.cfg.memory.chunkChars,
      overlap: this.cfg.memory.chunkOverlap,
      preserveMarkdown: source === "memory",
    });

    if (textChunks.length === 0) {
      // Still update file record even if empty
      const stats = await fs.stat(absPath);
      this.store.upsertFile(relPath, source, hash, stats.size, 0);
      return;
    }

    // Create memory chunks
    const chunks = createMemoryChunks(textChunks, relPath, source, hash);

    // Generate embeddings
    const embeddings = await this.embedder.embed(chunks.map((c) => c.text));

    // Update file record first (required for foreign key constraint)
    const stats = await fs.stat(absPath);
    const lines = raw.split("\n").length;
    this.store.upsertFile(relPath, source, hash, stats.size, lines);

    // Store in database
    this.store.storeChunks(relPath, chunks);
    this.store.storeEmbeddings(
      chunks.map((chunk, i) => ({
        chunkId: chunk.id,
        embedding: embeddings[i] ?? [],
        model: this.embedder.getModel(),
      })),
    );

    // Update sync state
    this.syncState.files[relPath] = {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      lines,
      hash,
    };
  }

  /**
   * Sync if needed based on trigger
   */
  async syncIfNeeded(reason: "search" | "interval" | "watch" | "startup"): Promise<void> {
    if (!this.cfg.memory.enabled) return;

    await this.loadSyncState();

    if (reason === "interval") {
      const minIntervalMs = this.cfg.memory.sync.intervalMinutes * 60_000;
      if (minIntervalMs > 0 && Date.now() - this.syncState.lastRunAt < minIntervalMs) {
        return;
      }
    }

    await this.indexAll();
    this.syncState.lastRunAt = Date.now();
    await this.persistSyncState();
  }

  /**
   * Load sync state from disk
   */
  private async loadSyncState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.syncStatePath, "utf-8");
      this.syncState = JSON.parse(raw) as MemorySyncState;
    } catch {
      this.syncState = { files: {}, lastRunAt: 0 };
    }
  }

  /**
   * Persist sync state to disk
   */
  private async persistSyncState(): Promise<void> {
    try {
      await fs.writeFile(
        this.syncStatePath,
        JSON.stringify(this.syncState, null, 2),
        "utf-8",
      );
    } catch {
      // Ignore write errors
    }
  }
}

/**
 * Compute SHA-256 hash of text
 */
function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// Re-export types
export type { MemorySearchResult } from "./types.js";

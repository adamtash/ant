/**
 * SQLite Store for Memory System
 * Phase 7: Memory System Redesign
 *
 * Features:
 * - Store embeddings and metadata
 * - Support semantic search with cosine similarity
 * - Incremental indexing
 * - Configurable retention
 */

import { DatabaseSync } from "node:sqlite";

import { cosineSimilarity } from "./embeddings.js";
import type { MemoryChunk, MemorySource, StoredEmbedding } from "./types.js";

/**
 * SQLite storage backend for memory system
 * 
 * Supports:
 * - Vector similarity search (cosine distance)
 * - FTS5 keyword search (full-text search)
 * - Session transcript delta tracking
 * - Incremental indexing
 */
export class SqliteStore {
  private readonly db: DatabaseSync;
  private readonly retentionDays: number;
  private ftsAvailable = false;

  constructor(dbPath: string, retentionDays = 30) {
    this.db = new DatabaseSync(dbPath);
    this.retentionDays = retentionDays;
    this.ensureSchema();
  }

  /**
   * Create database schema if not exists
   * 
   * Includes FTS5 virtual table for hybrid search
   */
  private ensureSchema(): void {
    this.db.exec(`
      -- File tracking for incremental updates
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        lines INTEGER NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Text chunks with metadata
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        source TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        FOREIGN KEY (path) REFERENCES files(path) ON DELETE CASCADE
      );

      -- Embeddings linked to chunks
      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
      );

      -- Session file delta tracking (for incremental indexing)
      CREATE TABLE IF NOT EXISTS session_deltas (
        session_path TEXT PRIMARY KEY,
        last_size INTEGER NOT NULL,
        last_indexed_at INTEGER NOT NULL,
        pending_bytes INTEGER NOT NULL DEFAULT 0,
        pending_messages INTEGER NOT NULL DEFAULT 0
      );

      -- Indexes for efficient queries
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);
      CREATE INDEX IF NOT EXISTS idx_files_source ON files(source);
      CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at);
    `);

    // Create FTS5 virtual table for keyword search
    this.ensureFtsTable();
  }

  /**
   * Ensure FTS5 table exists (optional - may fail on older SQLite)
   */
  private ensureFtsTable(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          text,
          id UNINDEXED,
          path UNINDEXED,
          source UNINDEXED,
          start_line UNINDEXED,
          end_line UNINDEXED
        );
      `);
      this.ftsAvailable = true;
    } catch {
      // FTS5 not available in this SQLite build
      this.ftsAvailable = false;
    }
  }

  /**
   * Check if FTS5 is available for hybrid search
   */
  isFtsAvailable(): boolean {
    return this.ftsAvailable;
  }

  /**
   * Check if a file needs re-indexing
   */
  fileNeedsUpdate(path: string, hash: string): boolean {
    const row = this.db
      .prepare("SELECT hash FROM files WHERE path = ?")
      .get(path) as { hash: string } | undefined;

    return !row || row.hash !== hash;
  }

  /**
   * Get file metadata
   */
  getFile(path: string): {
    hash: string;
    size: number;
    lines: number;
    indexedAt: number;
  } | null {
    const row = this.db.prepare("SELECT hash, size, lines, indexed_at FROM files WHERE path = ?").get(path) as
      | { hash: string; size: number; lines: number; indexed_at: number }
      | undefined;

    if (!row) return null;

    return {
      hash: row.hash,
      size: row.size,
      lines: row.lines,
      indexedAt: row.indexed_at,
    };
  }

  /**
   * Store or update file metadata
   */
  upsertFile(
    path: string,
    source: MemorySource,
    hash: string,
    size: number,
    lines: number,
  ): void {
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO files (path, source, hash, size, lines, indexed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           hash = excluded.hash,
           size = excluded.size,
           lines = excluded.lines,
           updated_at = excluded.updated_at`,
      )
      .run(path, source, hash, size, lines, now, now);
  }

  /**
   * Delete a file and its chunks/embeddings
   */
  deleteFile(path: string): void {
    // Delete embeddings first (no cascade in node:sqlite)
    this.db.prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE path = ?)").run(path);
    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(path);
    this.db.prepare("DELETE FROM files WHERE path = ?").run(path);
  }

  /**
   * Store chunks for a file (replaces existing)
   */
  storeChunks(path: string, chunks: MemoryChunk[]): void {
    // Delete existing chunks for this path
    this.db.prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE path = ?)").run(path);
    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(path);

    // Insert new chunks
    const stmt = this.db.prepare(
      `INSERT INTO chunks (id, path, source, start_line, end_line, text, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const chunk of chunks) {
      stmt.run(
        chunk.id,
        chunk.path,
        chunk.source,
        chunk.startLine,
        chunk.endLine,
        chunk.text,
        chunk.indexedAt,
      );
    }
  }

  /**
   * Store embeddings for chunks
   */
  storeEmbeddings(
    embeddings: Array<{ chunkId: string; embedding: number[]; model: string }>,
  ): void {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO embeddings (chunk_id, embedding, model, dimension, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const now = Date.now();

    for (const item of embeddings) {
      // Store as binary blob for efficiency
      const buffer = float32ArrayToBuffer(item.embedding);
      stmt.run(item.chunkId, buffer, item.model, item.embedding.length, now);
    }
  }

  /**
   * Get all chunks with embeddings for semantic search
   */
  getAllChunksWithEmbeddings(): Array<{
    chunk: MemoryChunk;
    embedding: number[];
  }> {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.text, c.indexed_at,
                e.embedding, e.dimension
         FROM chunks c
         JOIN embeddings e ON c.id = e.chunk_id`,
      )
      .all() as Array<{
      id: string;
      path: string;
      source: MemorySource;
      start_line: number;
      end_line: number;
      text: string;
      indexed_at: number;
      embedding: Buffer;
      dimension: number;
    }>;

    return rows.map((row) => ({
      chunk: {
        id: row.id,
        path: row.path,
        source: row.source,
        startLine: row.start_line,
        endLine: row.end_line,
        text: row.text,
        indexedAt: row.indexed_at,
      },
      embedding: bufferToFloat32Array(row.embedding, row.dimension),
    }));
  }

  /**
   * Search for similar chunks using cosine similarity
   */
  searchSimilar(
    queryEmbedding: number[],
    maxResults: number,
    minScore: number,
    sourceFilter?: MemorySource[],
  ): Array<{ chunk: MemoryChunk; score: number }> {
    const allChunks = this.getAllChunksWithEmbeddings();

    // Filter by source if specified
    const filtered = sourceFilter
      ? allChunks.filter((item) => sourceFilter.includes(item.chunk.source))
      : allChunks;

    // Calculate similarities
    const scored = filtered
      .map((item) => ({
        chunk: item.chunk,
        score: cosineSimilarity(queryEmbedding, item.embedding),
      }))
      .filter((item) => Number.isFinite(item.score) && item.score >= minScore);

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults);
  }

  /**
   * Get chunk by ID
   */
  getChunk(id: string): MemoryChunk | null {
    const row = this.db
      .prepare(
        "SELECT id, path, source, start_line, end_line, text, indexed_at FROM chunks WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          path: string;
          source: MemorySource;
          start_line: number;
          end_line: number;
          text: string;
          indexed_at: number;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      source: row.source,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      indexedAt: row.indexed_at,
    };
  }

  /**
   * Get chunks for a file
   */
  getChunksForFile(path: string): MemoryChunk[] {
    const rows = this.db
      .prepare(
        "SELECT id, path, source, start_line, end_line, text, indexed_at FROM chunks WHERE path = ? ORDER BY start_line",
      )
      .all(path) as Array<{
      id: string;
      path: string;
      source: MemorySource;
      start_line: number;
      end_line: number;
      text: string;
      indexed_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      source: row.source,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      indexedAt: row.indexed_at,
    }));
  }

  /**
   * List all indexed files
   */
  listFiles(source?: MemorySource): Array<{
    path: string;
    source: MemorySource;
    hash: string;
    indexedAt: number;
  }> {
    const query = source
      ? "SELECT path, source, hash, indexed_at FROM files WHERE source = ?"
      : "SELECT path, source, hash, indexed_at FROM files";

    const rows = (
      source ? this.db.prepare(query).all(source) : this.db.prepare(query).all()
    ) as Array<{
      path: string;
      source: MemorySource;
      hash: string;
      indexed_at: number;
    }>;

    return rows.map((row) => ({
      path: row.path,
      source: row.source,
      hash: row.hash,
      indexedAt: row.indexed_at,
    }));
  }

  /**
   * Get database statistics
   */
  getStats(): {
    fileCount: number;
    chunkCount: number;
    embeddingCount: number;
    dbSizeBytes: number;
  } {
    const fileCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM files").get() as {
        count: number;
      }
    ).count;

    const chunkCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as {
        count: number;
      }
    ).count;

    const embeddingCount = (
      this.db.prepare("SELECT COUNT(*) as count FROM embeddings").get() as {
        count: number;
      }
    ).count;

    // Estimate size from page_count * page_size
    const pageCount = (
      this.db.prepare("PRAGMA page_count").get() as { page_count: number }
    ).page_count;
    const pageSize = (
      this.db.prepare("PRAGMA page_size").get() as { page_size: number }
    ).page_size;

    return {
      fileCount,
      chunkCount,
      embeddingCount,
      dbSizeBytes: pageCount * pageSize,
    };
  }

  /**
   * Search using FTS5 (keyword search)
   * 
   * Uses full-text search for exact phrase matching and relevance
   */
  searchKeyword(
    ftsQuery: string,
    maxResults: number,
  ): Array<{
    id: string;
    path: string;
    source: MemorySource;
    startLine: number;
    endLine: number;
    snippet: string;
    textScore: number;
  }> {
    if (!this.ftsAvailable) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT 
             id, path, source, start_line, end_line, text,
             rank as bm25Rank
           FROM chunks_fts
           WHERE chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQuery, maxResults) as Array<{
        id: string;
        path: string;
        source: MemorySource;
        start_line: number;
        end_line: number;
        text: string;
        bm25Rank: number;
      }>;

      return rows.map((row) => {
        // BM25 rank to score: 1/(1+rank) gives us 0-1 range
        const textScore = 1 / (1 + Math.max(0, row.bm25Rank));

        // Truncate snippet to ~700 chars
        const snippet = row.text.slice(0, 700);

        return {
          id: row.id,
          path: row.path,
          source: row.source,
          startLine: row.start_line,
          endLine: row.end_line,
          snippet,
          textScore,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Index chunk in FTS5 table for keyword search
   */
  indexChunkFts(chunk: {
    id: string;
    path: string;
    source: MemorySource;
    startLine: number;
    endLine: number;
    text: string;
  }): void {
    if (!this.ftsAvailable) return;

    try {
      this.db
        .prepare(
          `INSERT INTO chunks_fts (text, id, path, source, start_line, end_line)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chunk.text,
          chunk.id,
          chunk.path,
          chunk.source,
          chunk.startLine,
          chunk.endLine,
        );
    } catch {
      // Ignore FTS indexing errors
    }
  }

  /**
   * Remove chunk from FTS5 index
   */
  removeChunkFts(chunkId: string): void {
    if (!this.ftsAvailable) return;

    try {
      this.db
        .prepare("DELETE FROM chunks_fts WHERE id = ?")
        .run(chunkId);
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get session delta tracking info
   */
  getSessionDelta(sessionPath: string): {
    lastSize: number;
    lastIndexedAt: number;
    pendingBytes: number;
    pendingMessages: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT last_size, last_indexed_at, pending_bytes, pending_messages
         FROM session_deltas WHERE session_path = ?`,
      )
      .get(sessionPath) as
      | {
          last_size: number;
          last_indexed_at: number;
          pending_bytes: number;
          pending_messages: number;
        }
      | undefined;

    if (!row) return null;

    return {
      lastSize: row.last_size,
      lastIndexedAt: row.last_indexed_at,
      pendingBytes: row.pending_bytes,
      pendingMessages: row.pending_messages,
    };
  }

  /**
   * Update session delta tracking
   */
  updateSessionDelta(sessionPath: string, updates: {
    lastSize?: number;
    pendingBytes?: number;
    pendingMessages?: number;
  }): void {
    const now = Date.now();
    const current = this.getSessionDelta(sessionPath) ?? {
      lastSize: 0,
      lastIndexedAt: now,
      pendingBytes: 0,
      pendingMessages: 0,
    };

    this.db
      .prepare(
        `INSERT OR REPLACE INTO session_deltas
         (session_path, last_size, last_indexed_at, pending_bytes, pending_messages)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        sessionPath,
        updates.lastSize ?? current.lastSize,
        now,
        updates.pendingBytes ?? current.pendingBytes,
        updates.pendingMessages ?? current.pendingMessages,
      );
  }

  /**
   * Clean up old session data beyond retention period
   */
  cleanupOldSessions(): number {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;

    // Get session files older than cutoff
    const oldFiles = this.db
      .prepare(
        "SELECT path FROM files WHERE source = 'sessions' AND updated_at < ?",
      )
      .all(cutoff) as Array<{ path: string }>;

    for (const file of oldFiles) {
      this.deleteFile(file.path);
    }

    return oldFiles.length;
  }

  /**
   * Vacuum the database to reclaim space
   */
  vacuum(): void {
    this.db.exec("VACUUM");
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Convert float32 array to buffer for storage
 */
function float32ArrayToBuffer(arr: number[]): Buffer {
  const float32 = new Float32Array(arr);
  return Buffer.from(float32.buffer);
}

/**
 * Convert buffer back to float32 array
 */
function bufferToFloat32Array(buffer: Buffer, dimension: number): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    dimension,
  );
  return Array.from(float32);
}

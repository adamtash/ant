/**
 * Memory System
 * Phase 7: Memory System Redesign
 *
 * Multi-tier memory architecture:
 * - Tier 1 (Short-term): Current session in RAM, last 5 sessions cached
 * - Tier 2 (Medium-term): SQLite index, session transcripts past 30 days
 * - Tier 3 (Long-term): MEMORY.md, memory/*.md files
 */

// Main manager
export { MemoryManager, type MemorySearchResult } from "./manager.js";

// SQLite store
export { SqliteStore } from "./sqlite-store.js";

// Embeddings
export {
  clearEmbeddingCache,
  cosineSimilarity,
  createEmbeddingProvider,
  findTopK,
  getEmbeddingCacheStats,
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "./embeddings.js";

// Chunking
export {
  chunkText,
  createMemoryChunks,
  DEFAULT_CHUNK_OPTIONS,
  estimateTokens,
  getOptimalChunkSize,
} from "./chunker.js";

// File watching
export {
  createMemoryFileWatcher,
  FileWatcher,
  listMemoryFiles,
  type FileWatcherCallback,
} from "./file-watcher.js";

// Types
export type {
  ChunkOptions,
  EmbeddingProvider,
  EmbeddingProviderConfig,
  FileSyncState,
  FileWatcherEvent,
  MemoryChunk,
  MemoryConfig,
  MemorySource,
  MemorySyncConfig,
  MemorySyncState,
  MemoryTier,
  ReadFileParams,
  ReadFileResult,
  RecallContext,
  ShortTermConfig,
  ShortTermMessage,
  ShortTermSession,
  StoredEmbedding,
} from "./types.js";

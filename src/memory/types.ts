/**
 * Memory System Types
 * Phase 7: Memory System Redesign
 */

/**
 * Result from a memory search operation
 */
export type MemorySearchResult = {
  /** Relative path to the source file */
  path: string;
  /** Starting line number in the source file */
  startLine: number;
  /** Ending line number in the source file */
  endLine: number;
  /** Similarity score (0-1) */
  score: number;
  /** Text snippet from the chunk */
  snippet: string;
  /** Source tier of the memory */
  source: MemorySource;
  /** Chunk ID for reference */
  chunkId: string;
  /** Memory category (if available) */
  category?: MemoryCategory;
  /** Priority (1-10) within category */
  priority?: number;
  /** Access count for the chunk */
  accessCount?: number;
  /** Last accessed timestamp */
  lastAccessedAt?: number;
};

/**
 * Memory source categories
 */
export type MemorySource = "memory" | "sessions" | "short-term";

/**
 * Memory tier levels
 */
export type MemoryTier = "short-term" | "medium-term" | "long-term";

/**
 * Memory importance category used for pruning and surfacing.
 */
export type MemoryCategory = "critical" | "important" | "contextual" | "ephemeral" | "diagnostic";

/**
 * A chunk of text with metadata
 */
export type MemoryChunk = {
  /** Unique chunk identifier */
  id: string;
  /** Relative path to source file */
  path: string;
  /** Source category */
  source: MemorySource;
  /** Starting line in source */
  startLine: number;
  /** Ending line in source */
  endLine: number;
  /** Chunk text content */
  text: string;
  /** Unix timestamp when indexed */
  indexedAt: number;
  /** Hash of the source file at index time */
  fileHash?: string;
  /** Memory category for pruning/surfacing */
  category?: MemoryCategory;
  /** Priority (1-10) within category */
  priority?: number;
  /** Access count for relevance */
  accessCount?: number;
  /** Last accessed timestamp */
  lastAccessedAt?: number;
  /** Soft-delete timestamp when pruned */
  prunedAt?: number;
};

/**
 * Stored embedding with chunk reference
 */
export type StoredEmbedding = {
  /** Chunk ID this embedding belongs to */
  chunkId: string;
  /** Embedding vector */
  embedding: number[];
  /** Model used to generate embedding */
  model: string;
  /** Unix timestamp when created */
  createdAt: number;
};

/**
 * Embedding provider configuration
 */
export type EmbeddingProviderConfig = {
  /** Provider type */
  type: "openai" | "local";
  /** Base URL for API */
  baseUrl: string;
  /** API key (optional for local) */
  apiKey?: string;
  /** Model name */
  model: string;
  /** Embedding dimension (for validation) */
  dimension?: number;
};

/**
 * Embedding provider interface
 */
export interface EmbeddingProvider {
  /** Generate embeddings for input texts */
  embed(texts: string[]): Promise<number[][]>;
  /** Get the model name */
  getModel(): string;
  /** Get embedding dimension */
  getDimension(): number | undefined;
}

/**
 * Memory configuration
 */
export type MemoryConfig = {
  /** Whether memory system is enabled */
  enabled: boolean;
  /** Whether to index session transcripts */
  indexSessions: boolean;
  /** Path to SQLite database */
  sqlitePath: string;
  /** Embedding model name */
  embeddingsModel: string;
  /** Sync configuration */
  sync: MemorySyncConfig;
  /** Chunking configuration */
  chunking: {
    /** Chunk size in tokens */
    tokens: number;
    /** Overlap between chunks in tokens */
    overlap: number;
  };
  /** Query configuration */
  query: {
    /** Maximum search results */
    maxResults: number;
    /** Minimum similarity score threshold */
    minScore: number;
  };
  /** Short-term memory settings */
  shortTerm?: ShortTermConfig;
  /** Medium-term retention in days */
  mediumTermRetentionDays?: number;
};

/**
 * Sync configuration
 */
export type MemorySyncConfig = {
  /** Sync on session start */
  onSessionStart: boolean;
  /** Sync on search */
  onSearch: boolean;
  /** Watch for file changes */
  watch: boolean;
  /** Debounce interval for file watcher */
  watchDebounceMs: number;
  /** Interval for periodic sync (0 = disabled) */
  intervalMinutes: number;
  /** Sessions sync configuration */
  sessions: {
    /** Bytes delta to trigger session re-index */
    deltaBytes: number;
    /** Messages delta to trigger session re-index */
    deltaMessages: number;
  };
};

/**
 * Short-term memory configuration
 */
export type ShortTermConfig = {
  /** Number of recent sessions to keep in cache */
  cachedSessions: number;
  /** Maximum age in minutes for short-term memory */
  maxAgeMinutes: number;
};

/**
 * Session info for short-term memory
 */
export type ShortTermSession = {
  /** Session key */
  sessionKey: string;
  /** Session messages */
  messages: ShortTermMessage[];
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Precomputed embeddings for this session */
  embeddings?: Map<string, number[]>;
};

/**
 * Message in short-term memory
 */
export type ShortTermMessage = {
  /** Message role */
  role: "system" | "user" | "assistant" | "tool";
  /** Message content */
  content: string;
  /** Timestamp */
  ts: number;
};

/**
 * Memory sync state persisted to disk
 */
export type MemorySyncState = {
  /** Last sync run timestamp */
  lastRunAt: number;
  /** Per-file sync state */
  files: Record<string, FileSyncState>;
};

/**
 * Per-file sync state
 */
export type FileSyncState = {
  /** File size at last sync */
  size: number;
  /** File mtime at last sync */
  mtimeMs: number;
  /** Line count at last sync */
  lines?: number;
  /** Content hash at last sync */
  hash?: string;
};

/**
 * File watcher event
 */
export type FileWatcherEvent = {
  /** Event type */
  type: "add" | "change" | "unlink";
  /** File path */
  path: string;
  /** Timestamp */
  timestamp: number;
};

/**
 * Chunking options
 */
export type ChunkOptions = {
  /** Target chunk size in characters */
  chunkSize: number;
  /** Overlap between chunks */
  overlap: number;
  /** Preserve markdown structure */
  preserveMarkdown: boolean;
};

/**
 * Read file parameters
 */
export type ReadFileParams = {
  /** Relative path to the file */
  relPath: string;
  /** Starting line (1-indexed) */
  from?: number;
  /** Number of lines to read */
  lines?: number;
};

/**
 * Read file result
 */
export type ReadFileResult = {
  /** Path that was read */
  path: string;
  /** File content */
  text: string;
};

/**
 * Recall context for a session
 */
export type RecallContext = {
  /** Session key */
  sessionKey: string;
  /** Relevant memory snippets */
  memories: string[];
  /** Scores for each memory */
  scores: number[];
};

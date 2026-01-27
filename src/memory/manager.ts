import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AntConfig } from "../config.js";
import type { OpenAIClient } from "../runtime/openai.js";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: "memory" | "sessions";
};

export class MemoryManager {
  private readonly cfg: AntConfig;
  private readonly db: DatabaseSync;
  private readonly client: OpenAIClient;
  private readonly embeddingModel: string;
  private readonly syncStatePath: string;
  private syncState: MemorySyncState;

  constructor(params: { cfg: AntConfig; client: OpenAIClient; embeddingModel: string }) {
    this.cfg = params.cfg;
    this.client = params.client;
    this.embeddingModel = params.embeddingModel;
    this.db = new DatabaseSync(params.cfg.resolved.memorySqlitePath);
    this.syncStatePath = path.join(params.cfg.resolved.stateDir, "memory-sync.json");
    this.syncState = { files: {}, lastRunAt: 0 };
    this.ensureSchema();
  }

  async indexAll(params?: { forceSessions?: boolean }): Promise<void> {
    if (!this.cfg.memory.enabled) return;
    await this.indexMemoryFiles();
    if (this.cfg.memory.indexSessions) {
      await this.indexSessionTranscripts(params?.forceSessions ?? false);
    }
    await this.persistSyncState();
  }

  async search(query: string, maxResults?: number, minScore?: number): Promise<MemorySearchResult[]> {
    if (!this.cfg.memory.enabled) return [];
    if (this.cfg.memory.sync.onSearch) {
      await this.syncIfNeeded("search");
    } else {
      await this.indexAll();
    }
    const { embeddings } = await this.client.embed({
      model: this.embeddingModel,
      input: [query],
    });
    const queryEmbedding = embeddings[0];
    if (!queryEmbedding) return [];

    const rows = this.db
      .prepare(
        "SELECT chunks.id as id, chunks.path as path, chunks.startLine as startLine, chunks.endLine as endLine, chunks.text as text, chunks.source as source, embeddings.embedding as embedding FROM chunks JOIN embeddings ON chunks.id = embeddings.chunk_id",
      )
      .all() as Array<{
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      source: "memory" | "sessions";
      embedding: string;
    }>;

    const scored = rows
      .map((row) => ({
        ...row,
        score: cosineSimilarity(queryEmbedding, JSON.parse(row.embedding) as number[]),
      }))
      .filter((row) => Number.isFinite(row.score));

    const threshold = minScore ?? this.cfg.memory.minScore;
    const limited = scored
      .filter((row) => row.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults ?? this.cfg.memory.maxResults);

    return limited.map((row) => ({
      path: row.path,
      startLine: row.startLine,
      endLine: row.endLine,
      score: row.score,
      snippet: row.text,
      source: row.source,
    }));
  }

  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ path: string; text: string }> {
    const rel = params.relPath.replace(/^\/+/, "");
    const base = rel.startsWith("sessions/")
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

  async syncIfNeeded(reason: "search" | "interval" | "watch" | "startup"): Promise<void> {
    if (!this.cfg.memory.enabled) return;
    await this.loadSyncState();
    if (reason === "interval") {
      const minIntervalMs = this.cfg.memory.sync.intervalMinutes * 60_000;
      if (minIntervalMs > 0 && Date.now() - this.syncState.lastRunAt < minIntervalMs) {
        return;
      }
    }
    const forceSessions = reason === "search";
    await this.indexAll({ forceSessions });
    this.syncState.lastRunAt = Date.now();
    await this.persistSyncState();
  }

  private ensureSchema() {
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, source TEXT, hash TEXT, updatedAt INTEGER)",
        "CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, path TEXT, source TEXT, startLine INTEGER, endLine INTEGER, text TEXT)",
        "CREATE TABLE IF NOT EXISTS embeddings (chunk_id TEXT PRIMARY KEY, embedding TEXT)",
      ].join(";"),
    );
  }

  private async indexMemoryFiles(): Promise<void> {
    const memoryFiles = await listMemoryFiles(this.cfg.resolved.workspaceDir);
    for (const entry of memoryFiles) {
      await this.indexFile(entry.path, "memory");
    }
  }

  private async indexSessionTranscripts(force: boolean): Promise<void> {
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
      if (!force) {
        const shouldIndex = await this.shouldIndexSessionFile(filePath, relPath);
        if (!shouldIndex) continue;
      }
      await this.indexFile(filePath, "sessions", relPath);
    }
  }

  private async indexFile(absPath: string, source: "memory" | "sessions", relOverride?: string) {
    const raw = await fs.readFile(absPath, "utf-8");
    const hash = sha256(raw);
    const relPath = relOverride ?? path.relative(this.cfg.resolved.workspaceDir, absPath);
    const stats = await fs.stat(absPath);

    const existing = this.db
      .prepare("SELECT hash FROM files WHERE path = ?")
      .get(relPath) as { hash?: string } | undefined;
    if (existing?.hash === hash) return;

    this.db.prepare("DELETE FROM chunks WHERE path = ?").run(relPath);
    this.db
      .prepare("DELETE FROM embeddings WHERE chunk_id NOT IN (SELECT id FROM chunks)")
      .run();

    const chunks = chunkText(raw, this.cfg.memory.chunkChars, this.cfg.memory.chunkOverlap);
    if (chunks.length === 0) {
      this.db
        .prepare("INSERT OR REPLACE INTO files (path, source, hash, updatedAt) VALUES (?, ?, ?, ?)")
        .run(relPath, source, hash, Date.now());
      return;
    }
    const embeddings = await embedInBatches(
      this.client,
      this.embeddingModel,
      chunks.map((c) => c.text),
    );

    const insertChunk = this.db.prepare(
      "INSERT OR REPLACE INTO chunks (id, path, source, startLine, endLine, text) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertEmbedding = this.db.prepare(
      "INSERT OR REPLACE INTO embeddings (chunk_id, embedding) VALUES (?, ?)",
    );

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const chunkId = `${relPath}#${i}`;
      insertChunk.run(chunkId, relPath, source, chunk.startLine, chunk.endLine, chunk.text);
      const embedding = embeddings[i] ?? [];
      insertEmbedding.run(chunkId, JSON.stringify(embedding));
    }

    this.db
      .prepare("INSERT OR REPLACE INTO files (path, source, hash, updatedAt) VALUES (?, ?, ?, ?)")
      .run(relPath, source, hash, Date.now());

    this.syncState.files[relPath] = {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      lines: countLines(raw),
    };
  }

  private async shouldIndexSessionFile(absPath: string, relPath: string): Promise<boolean> {
    const stats = await fs.stat(absPath);
    const prev = this.syncState.files[relPath];
    if (!prev) return true;
    const deltaBytes = Math.max(0, stats.size - prev.size);
    if (deltaBytes >= this.cfg.memory.sync.sessionsDeltaBytes) return true;
    if (this.cfg.memory.sync.sessionsDeltaMessages <= 0) return false;
    const raw = await fs.readFile(absPath, "utf-8");
    const lines = countLines(raw);
    const deltaLines = Math.max(0, lines - (prev.lines ?? 0));
    return deltaLines >= this.cfg.memory.sync.sessionsDeltaMessages;
  }

  private async loadSyncState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.syncStatePath, "utf-8");
      this.syncState = JSON.parse(raw) as MemorySyncState;
    } catch {
      this.syncState = { files: {}, lastRunAt: 0 };
    }
  }

  private async persistSyncState(): Promise<void> {
    await fs.writeFile(this.syncStatePath, JSON.stringify(this.syncState, null, 2), "utf-8");
  }
}

export async function listMemoryFiles(workspaceDir: string): Promise<Array<{ path: string }>> {
  const files: Array<{ path: string }> = [];
  const rootFiles = ["MEMORY.md", "memory.md"];
  for (const name of rootFiles) {
    const filePath = path.join(workspaceDir, name);
    try {
      await fs.access(filePath);
      files.push({ path: filePath });
    } catch {
      // ignore
    }
  }
  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir);
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      files.push({ path: path.join(memoryDir, name) });
    }
  } catch {
    // ignore
  }
  return files;
}

function chunkText(text: string, chunkChars: number, overlap: number) {
  const lines = text.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];
  let buffer: string[] = [];
  let startLine = 1;
  let charCount = 0;

  const flush = (endLine: number) => {
    if (buffer.length === 0) return;
    const chunkText = buffer.join("\n");
    chunks.push({ text: chunkText, startLine, endLine });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    buffer.push(line);
    charCount += line.length + 1;
    if (charCount >= chunkChars) {
      flush(i + 1);
      const overlapLines = overlap > 0 ? buffer.slice(Math.max(0, buffer.length - overlap)) : [];
      buffer = overlapLines;
      startLine = Math.max(1, i + 2 - overlapLines.length);
      charCount = overlapLines.join("\n").length;
    }
  }
  flush(lines.length);
  return chunks;
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

type MemorySyncState = {
  lastRunAt: number;
  files: Record<string, { size: number; mtimeMs: number; lines?: number }>;
};

function cosineSimilarity(a: number[], b: number[]): number {
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

async function embedInBatches(
  client: OpenAIClient,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  const batchSize = 64;
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const result = await client.embed({ model, input: batch });
    out.push(...result.embeddings);
  }
  return out;
}

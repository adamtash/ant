import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqliteState, DatabaseSyncMock } = vi.hoisted(() => {
  const sqliteState = {
    throwOnFts: false,
    execCalls: [] as string[],
    prepareCalls: [] as string[],
    prepared: new Map<string, any>(),
    closed: false,
  };

  class DatabaseSyncMock {
    constructor(_dbPath: string) {}

    exec(sql: string) {
      sqliteState.execCalls.push(sql);
      if (sqliteState.throwOnFts && sql.includes("CREATE VIRTUAL TABLE")) {
        throw new Error("FTS5 not available");
      }
    }

    prepare(sql: string) {
      sqliteState.prepareCalls.push(sql);
      const existing = sqliteState.prepared.get(sql);
      if (existing) return existing;
      const stmt = {
        sql,
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        run: vi.fn(() => undefined),
      };
      sqliteState.prepared.set(sql, stmt);
      return stmt;
    }

    close() {
      sqliteState.closed = true;
    }
  }

  return { sqliteState, DatabaseSyncMock };
});

vi.mock("node:sqlite", () => ({
  DatabaseSync: DatabaseSyncMock,
}));

import { SqliteStore } from "../../../src/memory/sqlite-store.js";

describe("SqliteStore (mocked node:sqlite)", () => {
  beforeEach(() => {
    sqliteState.throwOnFts = false;
    sqliteState.execCalls = [];
    sqliteState.prepareCalls = [];
    sqliteState.prepared = new Map();
    sqliteState.closed = false;
  });

  it("detects FTS availability when schema init succeeds", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    expect(store.isFtsAvailable()).toBe(true);
    expect(sqliteState.execCalls.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS files"))).toBe(true);
    expect(sqliteState.execCalls.some((sql) => sql.includes("CREATE VIRTUAL TABLE"))).toBe(true);
  });

  it("disables FTS when virtual table creation fails", () => {
    sqliteState.throwOnFts = true;
    const store = new SqliteStore("/tmp/test.sqlite");
    expect(store.isFtsAvailable()).toBe(false);
  });

  it("fileNeedsUpdate() returns true on missing row, false on same hash, true on mismatch", () => {
    const store = new SqliteStore("/tmp/test.sqlite");

    const sql = "SELECT hash FROM files WHERE path = ?";
    const stmt = { sql, get: vi.fn(), all: vi.fn(), run: vi.fn() };
    sqliteState.prepared.set(sql, stmt);

    stmt.get.mockReturnValueOnce(undefined);
    expect(store.fileNeedsUpdate("a", "h1")).toBe(true);

    stmt.get.mockReturnValueOnce({ hash: "h1" });
    expect(store.fileNeedsUpdate("a", "h1")).toBe(false);

    stmt.get.mockReturnValueOnce({ hash: "other" });
    expect(store.fileNeedsUpdate("a", "h1")).toBe(true);
  });

  it("upsertFile() issues an upsert statement with expected fields", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    store.upsertFile("file.md", "files", "hash", 10, 2);

    const sql = sqliteState.prepareCalls.find((q) => q.includes("INSERT INTO files"));
    expect(sql).toBeTruthy();
    const stmt = sqliteState.prepared.get(sql!);
    expect(stmt.run).toHaveBeenCalledWith(
      "file.md",
      "files",
      "hash",
      10,
      2,
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("storeChunks() clears existing rows and inserts new chunks", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    store.storeChunks("p", [
      {
        id: "c1",
        path: "p",
        source: "files",
        startLine: 1,
        endLine: 2,
        text: "hello",
        indexedAt: 123,
      },
      {
        id: "c2",
        path: "p",
        source: "files",
        startLine: 3,
        endLine: 4,
        text: "world",
        indexedAt: 123,
      },
    ]);

    const insertSql = sqliteState.prepareCalls.find((q) => q.includes("INSERT INTO chunks"));
    expect(insertSql).toBeTruthy();
    const insertStmt = sqliteState.prepared.get(insertSql!);
    expect(insertStmt.run).toHaveBeenCalledTimes(2);
    expect(insertStmt.run).toHaveBeenNthCalledWith(
      1,
      "c1",
      "p",
      "files",
      1,
      2,
      "hello",
      123,
      "contextual",
      5,
      0,
      0,
      null
    );
  });

  it("storeEmbeddings() stores embeddings as Buffer and records dimension", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    store.storeEmbeddings([
      { chunkId: "c1", embedding: [1, 2, 3], model: "m" },
      { chunkId: "c2", embedding: [4, 5], model: "m" },
    ]);

    const sql = sqliteState.prepareCalls.find((q) => q.includes("INSERT OR REPLACE INTO embeddings"));
    expect(sql).toBeTruthy();
    const stmt = sqliteState.prepared.get(sql!);
    expect(stmt.run).toHaveBeenCalledWith(
      "c1",
      expect.any(Buffer),
      "m",
      3,
      expect.any(Number)
    );
    expect(stmt.run).toHaveBeenCalledWith(
      "c2",
      expect.any(Buffer),
      "m",
      2,
      expect.any(Number)
    );
  });

  it("getAllChunksWithEmbeddings() maps rows to chunk+embedding pairs", () => {
    const store = new SqliteStore("/tmp/test.sqlite");

    // First call populates the prepared statement via the mock (defaults to empty rows).
    expect(store.getAllChunksWithEmbeddings()).toEqual([]);

    const sql = sqliteState.prepareCalls.find((q) => q.includes("JOIN embeddings"));
    expect(sql).toBeTruthy();
    const stmt = sqliteState.prepared.get(sql!);

    const buffer = Buffer.from(new Float32Array([0.25, 0.5]).buffer);
    stmt.all.mockReturnValue([
      {
        id: "c1",
        path: "p",
        source: "files",
        start_line: 1,
        end_line: 2,
        text: "t",
        indexed_at: 10,
        embedding: buffer,
        dimension: 2,
      },
    ]);

    const rows = store.getAllChunksWithEmbeddings();
    expect(rows[0].chunk.id).toBe("c1");
    expect(rows[0].embedding).toEqual([0.25, 0.5]);
  });

  it("searchKeyword() returns empty when FTS is disabled and handles query errors", () => {
    sqliteState.throwOnFts = true;
    const store = new SqliteStore("/tmp/test.sqlite");
    expect(store.searchKeyword("hello", 5)).toEqual([]);
  });

  it("searchKeyword() maps bm25 rank to 0-1 score and truncates snippet", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    expect(store.isFtsAvailable()).toBe(true);

    // First call populates the prepared statement via the mock (defaults to empty rows).
    expect(store.searchKeyword("hello", 10)).toEqual([]);

    const sql = sqliteState.prepareCalls.find((q) => q.includes("FROM chunks_fts"));
    expect(sql).toBeTruthy();
    const stmt = sqliteState.prepared.get(sql!);

    stmt.all.mockReturnValue([
      {
        id: "c1",
        path: "p",
        source: "files",
        start_line: 1,
        end_line: 2,
        text: "x".repeat(1000),
        bm25Rank: 0,
      },
      {
        id: "c2",
        path: "p",
        source: "files",
        start_line: 3,
        end_line: 4,
        text: "short",
        bm25Rank: 3,
      },
    ]);

    const results = store.searchKeyword("hello", 10);
    expect(results[0].textScore).toBe(1);
    expect(results[0].snippet.length).toBe(700);
    expect(results[1].textScore).toBeCloseTo(0.25);
  });

  it("getStats() computes db size from page_count * page_size", () => {
    const store = new SqliteStore("/tmp/test.sqlite");

    sqliteState.prepared.set("SELECT COUNT(*) as count FROM files", {
      get: vi.fn(() => ({ count: 2 })),
      all: vi.fn(),
      run: vi.fn(),
    });
    sqliteState.prepared.set("SELECT COUNT(*) as count FROM chunks", {
      get: vi.fn(() => ({ count: 3 })),
      all: vi.fn(),
      run: vi.fn(),
    });
    sqliteState.prepared.set("SELECT COUNT(*) as count FROM embeddings", {
      get: vi.fn(() => ({ count: 4 })),
      all: vi.fn(),
      run: vi.fn(),
    });
    sqliteState.prepared.set("PRAGMA page_count", {
      get: vi.fn(() => ({ page_count: 10 })),
      all: vi.fn(),
      run: vi.fn(),
    });
    sqliteState.prepared.set("PRAGMA page_size", {
      get: vi.fn(() => ({ page_size: 4096 })),
      all: vi.fn(),
      run: vi.fn(),
    });

    const stats = store.getStats();
    expect(stats).toEqual({
      fileCount: 2,
      chunkCount: 3,
      embeddingCount: 4,
      dbSizeBytes: 40960,
    });
  });

  it("cleanupOldSessions() deletes old session files and returns count", () => {
    const store = new SqliteStore("/tmp/test.sqlite", 0);

    const selectSql = "SELECT path FROM files WHERE source = 'sessions' AND updated_at < ?";
    sqliteState.prepared.set(selectSql, {
      get: vi.fn(),
      all: vi.fn(() => [{ path: "s1" }, { path: "s2" }]),
      run: vi.fn(),
    });

    const deleteSpy = vi.spyOn(store, "deleteFile").mockImplementation(() => {});
    expect(store.cleanupOldSessions()).toBe(2);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });

  it("vacuum() and close() proxy to the underlying database", () => {
    const store = new SqliteStore("/tmp/test.sqlite");
    store.vacuum();
    store.close();
    expect(sqliteState.execCalls.some((sql) => sql === "VACUUM")).toBe(true);
    expect(sqliteState.closed).toBe(true);
  });
});

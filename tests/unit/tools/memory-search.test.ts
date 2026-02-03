import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import memorySearchTool from "../../../src/tools/built-in/memory/search.js";

describe("memory_search tool", () => {
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-memory-search-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("finds matches in MEMORY.md, memory/*.md, and sessions", async () => {
    const workspaceDir = path.join(tempRoot, "workspace");
    const stateDir = path.join(tempRoot, "state");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.mkdir(path.join(stateDir, "sessions"), { recursive: true });

    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "line1\nTOKEN_ABC\nline3\n", "utf-8");
    await fs.writeFile(path.join(workspaceDir, "memory", "notes.md"), "hello\nTOKEN_ABC in notes\n", "utf-8");

    const sessionFile = path.join(stateDir, "sessions", "cli_default.jsonl");
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ role: "user", content: "no match", timestamp: 1 }),
        JSON.stringify({ role: "assistant", content: "TOKEN_ABC in session", timestamp: 2 }),
      ].join("\n") + "\n",
      "utf-8"
    );

    const result = await memorySearchTool.execute(
      { query: "TOKEN_ABC", maxResults: 10 },
      {
        workspaceDir,
        stateDir,
        sessionKey: "cli:default",
        chatId: "cli",
        logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } as any,
        config: { maxToolIterations: 1, maxHistoryTokens: 8000, temperature: 0.2 } as any,
      }
    );

    expect(result.ok).toBe(true);
    const data = result.data as any;
    const hits = Array.isArray(data?.results) ? data.results : [];

    expect(hits.some((h: any) => h.source === "memory" && h.path === "MEMORY.md")).toBe(true);
    expect(hits.some((h: any) => h.source === "memory" && String(h.path).includes("memory/"))).toBe(true);
    expect(hits.some((h: any) => h.source === "sessions" && String(h.path).startsWith("sessions/"))).toBe(true);
  });
});


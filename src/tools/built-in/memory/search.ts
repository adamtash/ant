/**
 * Memory Search Tool - Search through memory files and session transcripts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "memory_search",
    description: "Search MEMORY.md, memory/*.md, and session transcripts for relevant context. Returns snippets with path and line numbers.",
    category: "memory",
    version: "1.0.0",
  },
  parameters: defineParams({
    query: { type: "string", description: "Search query" },
    maxResults: { type: "number", description: "Maximum number of results (default 6)" },
    minScore: { type: "number", description: "Minimum relevance score 0-1 (default 0.35)" },
  }, ["query"]),
  async execute(args, ctx): Promise<ToolResult> {
    const query = String(args.query).trim();
    if (!query) {
      return { ok: false, error: "Query is required" };
    }

    const maxResults = typeof args.maxResults === "number" ? args.maxResults : 6;
    const minScore = typeof args.minScore === "number" ? args.minScore : 0.35;

    try {
      if (ctx.memoryManager) {
        const results = await ctx.memoryManager.search(query, {
          maxResults,
          minScore,
        });
        return {
          ok: true,
          data: {
            query,
            results,
          },
        };
      }

      const results = await searchWorkspaceAndSessions({
        query,
        maxResults,
        minScore,
        workspaceDir: ctx.workspaceDir,
        stateDir: ctx.stateDir,
      });

      return {
        ok: true,
        data: {
          query,
          results,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const hint = message.includes("No models loaded")
        ? "Load an embeddings-capable model in LM Studio or set memory.enabled=false."
        : undefined;

      return {
        ok: false,
        error: message,
        data: { hint },
      };
    }
  },
});

async function searchWorkspaceAndSessions(params: {
  query: string;
  maxResults: number;
  minScore: number;
  workspaceDir: string;
  stateDir: string;
}): Promise<
  Array<{
    source: "memory" | "sessions";
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
  }>
> {
  const queryLower = params.query.toLowerCase();
  const results: Array<{
    source: "memory" | "sessions";
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
  }> = [];

  const push = (item: (typeof results)[number]) => {
    if (item.score < params.minScore) return;
    results.push(item);
  };

  // MEMORY.md at workspace root
  const memoryRoot = path.join(params.workspaceDir, "MEMORY.md");
  await searchTextFile(memoryRoot, params.workspaceDir, queryLower, (hit) => push({ ...hit, source: "memory" }), params.maxResults - results.length);

  // memory/*.md
  const memoryDir = path.join(params.workspaceDir, "memory");
  const memoryFiles = await listMarkdownFiles(memoryDir);
  for (const filePath of memoryFiles) {
    if (results.length >= params.maxResults) break;
    await searchTextFile(filePath, params.workspaceDir, queryLower, (hit) => push({ ...hit, source: "memory" }), params.maxResults - results.length);
  }

  // session transcripts: .ant/sessions/*.jsonl
  const sessionsDir = path.join(params.stateDir, "sessions");
  const sessionFiles = await safeReadDir(sessionsDir);
  for (const name of sessionFiles) {
    if (results.length >= params.maxResults) break;
    if (!name.endsWith(".jsonl")) continue;
    const filePath = path.join(sessionsDir, name);
    await searchJsonlSession(filePath, sessionsDir, queryLower, (hit) => push({ ...hit, source: "sessions" }), params.maxResults - results.length);
  }

  return results.slice(0, params.maxResults);
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await safeReadDir(dir);
  return entries
    .filter((n) => n.endsWith(".md"))
    .map((n) => path.join(dir, n));
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function searchTextFile(
  filePath: string,
  workspaceDir: string,
  queryLower: string,
  onHit: (hit: { path: string; startLine: number; endLine: number; score: number; snippet: string }) => void,
  remaining: number
): Promise<void> {
  if (remaining <= 0) return;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const rel = path.relative(workspaceDir, filePath) || path.basename(filePath);
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (remaining <= 0) return;
      const line = lines[i] ?? "";
      if (!line.toLowerCase().includes(queryLower)) continue;
      const score = 1.0;
      onHit({
        path: rel,
        startLine: i + 1,
        endLine: i + 1,
        score,
        snippet: line.trim().slice(0, 500),
      });
      remaining -= 1;
    }
  } catch {
    // ignore missing/unreadable files
  }
}

async function searchJsonlSession(
  filePath: string,
  sessionsDir: string,
  queryLower: string,
  onHit: (hit: { path: string; startLine: number; endLine: number; score: number; snippet: string }) => void,
  remaining: number
): Promise<void> {
  if (remaining <= 0) return;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const rel = path.relative(sessionsDir, filePath) || path.basename(filePath);
    const lines = content.split("\n").filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      if (remaining <= 0) return;
      const raw = lines[i] ?? "";
      let text = "";
      try {
        const parsed = JSON.parse(raw) as { content?: unknown; role?: unknown; name?: unknown } | null;
        const contentValue = parsed && typeof parsed === "object" ? (parsed as any).content : "";
        const role = parsed && typeof parsed === "object" ? (parsed as any).role : undefined;
        const name = parsed && typeof parsed === "object" ? (parsed as any).name : undefined;
        text = typeof contentValue === "string" ? contentValue : String(contentValue ?? "");
        const prefix = `${typeof role === "string" ? role : "message"}${typeof name === "string" ? `(${name})` : ""}`;
        const snippetCandidate = `${prefix}: ${text}`.trim();
        if (!snippetCandidate.toLowerCase().includes(queryLower)) continue;
        onHit({
          path: `sessions/${rel}`,
          startLine: i + 1,
          endLine: i + 1,
          score: 0.7,
          snippet: snippetCandidate.slice(0, 500),
        });
        remaining -= 1;
      } catch {
        // ignore parse errors
      }
    }
  } catch {
    // ignore
  }
}

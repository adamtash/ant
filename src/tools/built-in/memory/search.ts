/**
 * Memory Search Tool - Search through memory files and session transcripts
 */

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

    // Note: This tool requires memory manager to be injected via context
    // For now, return a placeholder that indicates memory search is not available
    // The actual implementation will use ctx.memory.search()

    try {
      // Placeholder - in production, this would call:
      // const results = await ctx.memory.search(query, maxResults, minScore);

      return {
        ok: true,
        data: {
          query,
          results: [],
          message: "Memory search requires memory manager integration",
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

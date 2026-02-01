/**
 * Memory Update Tool - Add content to memory
 */

import fs from "node:fs/promises";
import path from "node:path";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "memory_update",
    description: "Add a note to MEMORY.md for long-term recall.",
    category: "memory",
    version: "1.0.0",
  },
  parameters: defineParams({
    note: { type: "string", description: "The note to add to memory" },
    category: { type: "string", description: "Optional category/section for the note" },
  }, ["note"]),
  async execute(args, ctx): Promise<ToolResult> {
    const note = String(args.note).trim();
    if (!note) {
      return { ok: false, error: "Note content is required" };
    }

    const category = typeof args.category === "string" ? args.category.trim() : undefined;

    try {
      const filePath = path.join(ctx.workspaceDir, "MEMORY.md");
      const date = new Date().toISOString().slice(0, 10);

      let line: string;
      if (category) {
        line = `- [${date}] **${category}**: ${note}`;
      } else {
        line = `- [${date}] ${note}`;
      }

      // Ensure file exists
      await fs.mkdir(ctx.workspaceDir, { recursive: true });

      // Append to file
      await fs.appendFile(filePath, `${line}\n`, "utf-8");

      return {
        ok: true,
        data: {
          saved: true,
          path: filePath,
          note: line,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

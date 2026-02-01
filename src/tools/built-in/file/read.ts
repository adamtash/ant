/**
 * File Read Tool - Read text files from disk
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "read",
    description: "Read a text file from disk. Returns file content with optional line range.",
    category: "file",
    version: "1.0.0",
  },
  parameters: defineParams({
    path: { type: "string", description: "Path to the file (relative to workspace or absolute)" },
    from: { type: "number", description: "Line number to start reading from (1-indexed)" },
    lines: { type: "number", description: "Number of lines to read" },
  }, ["path"]),
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = resolvePath(String(args.path), ctx.workspaceDir);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const allLines = raw.split("\n");

      const from = typeof args.from === "number" && args.from > 0 ? args.from - 1 : 0;
      const lineCount = typeof args.lines === "number" && args.lines > 0 ? args.lines : allLines.length;
      const slice = allLines.slice(from, from + lineCount);

      return {
        ok: true,
        data: {
          path: filePath,
          text: slice.join("\n"),
          totalLines: allLines.length,
          readFrom: from + 1,
          readLines: slice.length,
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

function resolvePath(value: string, workspaceDir: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("path is required");
  if (trimmed.startsWith("~")) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  return path.resolve(workspaceDir, trimmed);
}

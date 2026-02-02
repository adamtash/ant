/**
 * File Read Tool - Read text files from disk
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

const MAX_TOOL_OUTPUT_BYTES = 5_000_000; // 5MB

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
      // Check file size before reading
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_TOOL_OUTPUT_BYTES) {
        ctx.logger?.warn({ filePath, size: stats.size }, "File exceeds maximum size limit");
        return {
          ok: false,
          error: `File is too large (${(stats.size / 1_000_000).toFixed(2)}MB). Maximum allowed size is 5MB. Use the 'from' and 'lines' parameters to read a specific range.`,
        };
      }

      const raw = await fs.readFile(filePath, "utf-8");
      const allLines = raw.split("\n");

      const from = typeof args.from === "number" && args.from > 0 ? args.from - 1 : 0;
      const lineCount = typeof args.lines === "number" && args.lines > 0 ? args.lines : allLines.length;
      const slice = allLines.slice(from, from + lineCount);

      let text = slice.join("\n");

      // Truncate output if it exceeds the limit
      let truncated = false;
      if (Buffer.byteLength(text, "utf-8") > MAX_TOOL_OUTPUT_BYTES) {
        ctx.logger?.warn({ filePath, outputSize: Buffer.byteLength(text, "utf-8") }, "Output exceeds maximum size, truncating");
        const warningMessage = "\n\n[WARNING: Output truncated - file content exceeds 5MB limit. Use 'from' and 'lines' parameters to read specific sections.]";
        const maxContentBytes = MAX_TOOL_OUTPUT_BYTES - Buffer.byteLength(warningMessage, "utf-8");
        
        // Truncate to fit within limit
        while (Buffer.byteLength(text, "utf-8") > maxContentBytes && text.length > 0) {
          text = text.slice(0, -1000);
        }
        text = text + warningMessage;
        truncated = true;
      }

      return {
        ok: true,
        data: {
          path: filePath,
          text,
          totalLines: allLines.length,
          readFrom: from + 1,
          readLines: slice.length,
          truncated,
        },
      };
    } catch (err) {
      ctx.logger?.error({ filePath, error: err instanceof Error ? err.message : String(err) }, "Failed to read file");
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

/**
 * File Write Tool - Write or append to text files
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "write",
    description: "Write a text file to disk. Can overwrite or append.",
    category: "file",
    version: "1.0.0",
  },
  parameters: defineParams({
    path: { type: "string", description: "Path to the file (relative to workspace or absolute)" },
    content: { type: "string", description: "Content to write" },
    append: { type: "boolean", description: "If true, append to file instead of overwriting" },
  }, ["path", "content"]),
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = resolvePath(String(args.path), ctx.workspaceDir);
    const content = String(args.content);
    const append = Boolean(args.append);

    try {
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (append) {
        await fs.appendFile(filePath, content, "utf-8");
      } else {
        await fs.writeFile(filePath, content, "utf-8");
      }

      return {
        ok: true,
        data: {
          path: filePath,
          mode: append ? "append" : "write",
          bytes: Buffer.byteLength(content, "utf-8"),
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

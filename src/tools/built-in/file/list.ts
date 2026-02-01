/**
 * File List Tool - List directory contents
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "ls",
    description: "List files and directories in a path.",
    category: "file",
    version: "1.0.0",
  },
  parameters: defineParams({
    path: { type: "string", description: "Directory path (defaults to workspace)" },
    all: { type: "boolean", description: "Include hidden files (starting with .)" },
  }, []),
  async execute(args, ctx): Promise<ToolResult> {
    const dir = args.path
      ? resolvePath(String(args.path), ctx.workspaceDir)
      : ctx.workspaceDir;
    const showHidden = Boolean(args.all);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      const items = entries
        .filter(entry => showHidden || !entry.name.startsWith("."))
        .map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
        }));

      return {
        ok: true,
        data: {
          path: dir,
          entries: items,
          count: items.length,
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

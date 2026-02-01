/**
 * Send File Tool - Send files/media to chat channels
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "send_file",
    description: "Send a file (image, video, document) to the current chat.",
    category: "messaging",
    version: "1.0.0",
  },
  parameters: defineParams({
    path: { type: "string", description: "Path to the file" },
    type: { type: "string", description: "File type: image, video, or document" },
    caption: { type: "string", description: "Optional caption for the file" },
  }, ["path"]),
  async execute(args, ctx): Promise<ToolResult> {
    const filePath = resolvePath(String(args.path), ctx.workspaceDir);
    const fileType = typeof args.type === "string" ? args.type : "document";
    const caption = typeof args.caption === "string" ? args.caption : undefined;

    // Verify file exists
    try {
      await fs.access(filePath);
    } catch {
      return { ok: false, error: `File not found: ${filePath}` };
    }

    // Return with media metadata for channel adapter to handle
    return {
      ok: true,
      data: {
        path: filePath,
        type: fileType,
        caption,
      },
      metadata: {
        mediaPath: filePath,
      },
    };
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

import type { ToolPart } from "../agent/types.js";

export interface ToolMediaAttachment {
  path: string;
  caption?: string;
  tool: string;
  partId: string;
  callId: string;
}

export function collectToolMediaAttachments(params: {
  toolParts: ToolPart[];
  startedAt: number;
}): ToolMediaAttachment[] {
  const attachments: ToolMediaAttachment[] = [];
  const seen = new Set<string>();

  for (const part of params.toolParts) {
    if (part.state.status !== "completed") continue;

    const meta = part.state.metadata as Record<string, unknown> | undefined;
    const mediaPath = typeof meta?.mediaPath === "string" ? meta.mediaPath.trim() : "";
    if (!mediaPath) continue;

    const timeEnd = part.state.time.end;
    if (typeof timeEnd === "number" && timeEnd < params.startedAt) continue;

    if (seen.has(mediaPath)) continue;
    seen.add(mediaPath);

    let caption: string | undefined;
    try {
      const parsed = JSON.parse(part.state.output) as { data?: unknown } | null;
      const data = parsed && typeof parsed === "object" ? (parsed as any).data : undefined;
      caption = typeof data?.caption === "string" ? data.caption.trim() : undefined;
      if (!caption) caption = undefined;
    } catch {
      caption = undefined;
    }

    attachments.push({
      path: mediaPath,
      caption,
      tool: part.tool,
      partId: part.id,
      callId: part.callId,
    });
  }

  return attachments;
}


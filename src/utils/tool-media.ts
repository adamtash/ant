import type { ToolPart } from "../agent/types.js";

export interface ToolMediaAttachment {
  path: string;
  caption?: string;
  mediaType?: "image" | "video" | "audio" | "file";
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
    let mediaType: ToolMediaAttachment["mediaType"];
    try {
      const parsed = JSON.parse(part.state.output) as { data?: unknown } | null;
      const data = parsed && typeof parsed === "object" ? (parsed as any).data : undefined;
      caption = typeof data?.caption === "string" ? data.caption.trim() : undefined;
      if (!caption) caption = undefined;

      const rawType = typeof data?.type === "string" ? data.type.trim().toLowerCase() : "";
      if (rawType === "image" || rawType === "video" || rawType === "audio" || rawType === "file") {
        mediaType = rawType;
      } else if (rawType === "document") {
        mediaType = "file";
      }
    } catch {
      caption = undefined;
      mediaType = undefined;
    }

    attachments.push({
      path: mediaPath,
      caption,
      mediaType,
      tool: part.tool,
      partId: part.id,
      callId: part.callId,
    });
  }

  return attachments;
}

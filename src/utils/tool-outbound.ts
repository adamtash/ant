import type { Channel, ToolPart } from "../agent/types.js";

export interface ToolOutboundMessage {
  channel: Channel;
  chatId?: string;
  sessionKey: string;
  content: string;
  tool: string;
  partId: string;
  callId: string;
}

function isChannel(value: unknown): value is Channel {
  return (
    value === "whatsapp" ||
    value === "cli" ||
    value === "web" ||
    value === "telegram" ||
    value === "discord"
  );
}

export function collectToolOutboundMessages(params: {
  toolParts: ToolPart[];
  startedAt: number;
}): ToolOutboundMessage[] {
  const messages: ToolOutboundMessage[] = [];
  const seen = new Set<string>();

  for (const part of params.toolParts) {
    if (part.state.status !== "completed") continue;

    const timeEnd = part.state.time.end;
    if (typeof timeEnd === "number" && timeEnd < params.startedAt) continue;

    const meta = part.state.metadata as Record<string, unknown> | undefined;
    const outbound = meta && typeof meta === "object" ? (meta as any).outboundMessage : undefined;
    if (!outbound || typeof outbound !== "object") continue;

    const sessionKey = typeof outbound.sessionKey === "string" ? outbound.sessionKey.trim() : "";
    if (!sessionKey) continue;

    const content = typeof outbound.content === "string" ? outbound.content : "";
    if (!content) continue;

    const channel = isChannel(outbound.channel) ? outbound.channel : undefined;
    const chatId = typeof outbound.chatId === "string" ? outbound.chatId : undefined;

    const dedupeKey = `${part.id}:${sessionKey}:${content}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    messages.push({
      channel: channel ?? "whatsapp",
      chatId,
      sessionKey,
      content,
      tool: part.tool,
      partId: part.id,
      callId: part.callId,
    });
  }

  return messages;
}


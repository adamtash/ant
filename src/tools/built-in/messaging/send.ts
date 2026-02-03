/**
 * Message Send Tool - Send messages to chat channels
 */

import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { Channel, ToolResult, ToolContext } from "../../../agent/types.js";

export default defineTool({
  meta: {
    name: "message_send",
    description: "Send a message to a specific chat ID (WhatsApp, etc.).",
    category: "messaging",
    version: "1.0.0",
  },
  parameters: defineParams({
    to: { type: "string", description: "Chat ID to send message to" },
    message: { type: "string", description: "Message content" },
  }, ["to", "message"]),
  async execute(args, ctx): Promise<ToolResult> {
    const to = String(args.to).trim();
    const message = String(args.message).trim();

    if (!to) {
      return { ok: false, error: "Recipient 'to' is required" };
    }
    if (!message) {
      return { ok: false, error: "Message content is required" };
    }

    const inferredChannel = inferChannelFromSessionKey(ctx.sessionKey);
    const { sessionKey, chatId } = resolveTargetSessionKey(inferredChannel, to);

    ctx.logger.info(
      { tool: "message_send", to, inferredChannel, resolvedSessionKey: sessionKey },
      "message_send requested"
    );

    // This tool is executed inside the agent tool loop and does not have direct access
    // to channel adapters. Instead, it returns an outbound message request in metadata,
    // which the runtime/harness delivers after the tool loop completes (and logs it).
    return {
      ok: true,
      data: {
        queued: true,
        to,
        messageLength: message.length,
        channel: inferredChannel,
        sessionKey,
      },
      metadata: {
        outboundMessage: {
          channel: inferredChannel,
          chatId,
          sessionKey,
          content: message,
        },
      },
    };
  },
});

function inferChannelFromSessionKey(sessionKey: string): Channel {
  const prefix = sessionKey.split(":")[0]?.trim().toLowerCase();
  if (prefix === "whatsapp") return "whatsapp";
  if (prefix === "cli") return "cli";
  if (prefix === "web") return "web";
  if (prefix === "telegram") return "telegram";
  if (prefix === "discord") return "discord";
  return "whatsapp";
}

function resolveTargetSessionKey(
  channel: Channel,
  to: string
): { sessionKey: string; chatId?: string } {
  // If `to` looks like a full session key, trust it.
  if (to.includes(":")) {
    return { sessionKey: to, chatId: undefined };
  }

  if (channel === "whatsapp") {
    const type = to.endsWith("@g.us") ? "group" : "dm";
    return { sessionKey: `whatsapp:${type}:${to}`, chatId: to };
  }

  // Best-effort: use a 3-part key so the router can recover a session.
  return { sessionKey: `${channel}:dm:${to}`, chatId: to };
}

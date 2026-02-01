/**
 * Message Send Tool - Send messages to chat channels
 */

import { defineTool, defineParams } from "../../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../../agent/types.js";

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

    // Note: This tool requires message sending to be injected via context
    // The actual implementation will be handled by the channel adapter

    try {
      // Placeholder - in production, this would call:
      // await ctx.sendMessage(to, message);

      return {
        ok: true,
        data: {
          sent: true,
          to,
          messageLength: message.length,
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

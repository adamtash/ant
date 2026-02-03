import type { SessionManager, SessionMessage } from "../gateway/session-manager.js";
import type { Logger } from "../log.js";
import type { Channel, ToolCall, ToolPart, ToolResult } from "./types.js";

export async function persistToolResult(params: {
  sessionManager: SessionManager | undefined;
  sessionKey: string;
  channel?: Channel;
  chatId?: string;
  toolCall: ToolCall;
  result: ToolResult;
  toolPart?: ToolPart;
  logger: Logger;
}): Promise<void> {
  if (!params.sessionManager) return;

  const message: SessionMessage = {
    role: "tool",
    content: JSON.stringify({
      tool: params.toolCall.name,
      toolCallId: params.toolCall.id,
      ok: params.result.ok,
      data: params.result.data,
      error: params.result.error,
    }),
    timestamp: Date.now(),
    channel: params.channel,
    chatId: params.chatId,
    toolCallId: params.toolCall.id,
    name: params.toolCall.name,
  };

  try {
    await params.sessionManager.appendMessage(params.sessionKey, message);
    if (params.toolPart) {
      await params.sessionManager.upsertToolPart(params.sessionKey, params.toolPart);
    }
  } catch (err) {
    params.logger.warn(
      { error: err instanceof Error ? err.message : String(err), tool: params.toolCall.name },
      "Failed to persist tool result"
    );
  }
}

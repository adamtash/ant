/**
 * Telegram Message Handler
 *
 * Minimal helpers for Telegram message processing.
 */

import type { Message, MessageEntity, User } from "grammy/types";

// ============================================================================
// Message Extraction
// ============================================================================

export function extractTextFromMessage(message: Message | undefined): string | null {
  if (!message) return null;

  if (message.text && message.text.trim()) {
    return message.text.trim();
  }

  if (message.caption && message.caption.trim()) {
    return message.caption.trim();
  }

  if (message.photo) return "[Photo]";
  if (message.video) return "[Video]";
  if (message.document) return "[File]";
  if (message.audio || message.voice) return "[Audio message]";
  if (message.sticker) return "[Sticker]";
  if (message.contact) return "[Contact]";
  if (message.location) return "[Location]";

  return null;
}

export function hasKeywordMention(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => keyword && lower.includes(keyword.toLowerCase()));
}

// ============================================================================
// Mention Parsing
// ============================================================================

function normalizeMention(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed.toLowerCase() : `@${trimmed.toLowerCase()}`;
}

export function hasMentionOfUser(params: {
  message: Message | undefined;
  username?: string;
  userId?: number;
}): boolean {
  const { message, username, userId } = params;
  if (!message) return false;

  const text = message.text ?? message.caption ?? "";
  const entities = message.entities ?? message.caption_entities ?? [];
  if (!text || entities.length === 0) return false;

  const targetMention = normalizeMention(username);

  for (const entity of entities) {
    if (entity.type === "mention" && targetMention) {
      const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
      if (mention === targetMention) return true;
    }

    if (entity.type === "text_mention" && userId !== undefined) {
      const ent = entity as MessageEntity.TextMentionMessageEntity;
      if (ent.user?.id === userId) return true;
    }
  }

  // Fallback: simple text check for @username
  if (targetMention && text.toLowerCase().includes(targetMention)) return true;

  return false;
}

export function isGroupChatType(chatType: string | undefined): boolean {
  return chatType === "group" || chatType === "supergroup" || chatType === "channel";
}

export function getSenderLabel(sender: User | undefined): string {
  if (!sender) return "Unknown";
  if (sender.username) return sender.username;
  const name = [sender.first_name, sender.last_name].filter(Boolean).join(" ").trim();
  return name || "Unknown";
}

/**
 * WhatsApp Message Handler
 *
 * Handles WhatsApp-specific message processing, including:
 * - Text extraction from various message types
 * - Media handling
 * - Group/DM detection
 * - Mention parsing
 */

import type { WAMessage } from "@whiskeysockets/baileys";
import type { NormalizedMessage, MessageMedia } from "../types.js";

// ============================================================================
// Message Extraction
// ============================================================================

/**
 * Extract text content from a WhatsApp message
 */
export function extractTextFromMessage(msg: WAMessage): string | null {
  const message = msg.message;
  if (!message) return null;

  // Direct conversation
  if (message.conversation) {
    return message.conversation.trim();
  }

  // Extended text (with formatting, links, mentions)
  if (message.extendedTextMessage?.text) {
    return message.extendedTextMessage.text.trim();
  }

  // Image caption
  if (message.imageMessage?.caption) {
    return message.imageMessage.caption.trim();
  }

  // Video caption
  if (message.videoMessage?.caption) {
    return message.videoMessage.caption.trim();
  }

  // Document caption
  if (message.documentMessage?.caption) {
    return message.documentMessage.caption.trim();
  }

  // Audio messages have no text
  if (message.audioMessage) {
    return "[Audio message]";
  }

  // Sticker messages
  if (message.stickerMessage) {
    return "[Sticker]";
  }

  // Contact card
  if (message.contactMessage) {
    const name = message.contactMessage.displayName || "Unknown";
    return `[Contact: ${name}]`;
  }

  // Location
  if (message.locationMessage) {
    const lat = message.locationMessage.degreesLatitude;
    const lng = message.locationMessage.degreesLongitude;
    return `[Location: ${lat}, ${lng}]`;
  }

  return null;
}

/**
 * Extract mentions from a message
 */
export function extractMentions(msg: WAMessage): string[] {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  return ctx?.mentionedJid ?? [];
}

/**
 * Check if the message contains a keyword mention
 */
export function hasKeywordMention(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => keyword && lower.includes(keyword.toLowerCase()));
}

// ============================================================================
// Media Handling
// ============================================================================

/**
 * Media info extracted from WhatsApp message
 */
export interface WhatsAppMediaInfo {
  type: "image" | "video" | "audio" | "file";
  mimeType: string;
  filename?: string;
  fileLength?: number;
  mediaKey?: Uint8Array;
  url?: string;
}

/**
 * Extract media information from a WhatsApp message
 */
export function extractMediaInfo(msg: WAMessage): WhatsAppMediaInfo | null {
  const message = msg.message;
  if (!message) return null;

  if (message.imageMessage) {
    return {
      type: "image",
      mimeType: message.imageMessage.mimetype || "image/jpeg",
      fileLength: Number(message.imageMessage.fileLength) || undefined,
      mediaKey: message.imageMessage.mediaKey || undefined,
      url: message.imageMessage.url || undefined,
    };
  }

  if (message.videoMessage) {
    return {
      type: "video",
      mimeType: message.videoMessage.mimetype || "video/mp4",
      fileLength: Number(message.videoMessage.fileLength) || undefined,
      mediaKey: message.videoMessage.mediaKey || undefined,
      url: message.videoMessage.url || undefined,
    };
  }

  if (message.audioMessage) {
    return {
      type: "audio",
      mimeType: message.audioMessage.mimetype || "audio/ogg",
      fileLength: Number(message.audioMessage.fileLength) || undefined,
      mediaKey: message.audioMessage.mediaKey || undefined,
      url: message.audioMessage.url || undefined,
    };
  }

  if (message.documentMessage) {
    return {
      type: "file",
      mimeType: message.documentMessage.mimetype || "application/octet-stream",
      filename: message.documentMessage.fileName || undefined,
      fileLength: Number(message.documentMessage.fileLength) || undefined,
      mediaKey: message.documentMessage.mediaKey || undefined,
      url: message.documentMessage.url || undefined,
    };
  }

  if (message.stickerMessage) {
    return {
      type: "image",
      mimeType: message.stickerMessage.mimetype || "image/webp",
      mediaKey: message.stickerMessage.mediaKey || undefined,
      url: message.stickerMessage.url || undefined,
    };
  }

  return null;
}

/**
 * Convert WhatsApp media info to normalized MessageMedia
 * Note: Actual media download would need to be handled separately
 */
export function toNormalizedMedia(
  info: WhatsAppMediaInfo,
  data?: Buffer
): MessageMedia {
  return {
    type: info.type,
    data: data ?? info.url ?? "",
    mimeType: info.mimeType,
    filename: info.filename,
  };
}

// ============================================================================
// Message Classification
// ============================================================================

/**
 * Check if a JID is a group
 */
export function isGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith("@g.us"));
}

/**
 * Check if a JID is a broadcast list
 */
export function isBroadcastJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith("@broadcast"));
}

/**
 * Check if a JID is a status update
 */
export function isStatusJid(jid: string | null | undefined): boolean {
  return jid === "status@broadcast";
}

/**
 * Normalize a JID for comparison
 */
export function normalizeJid(jid: string | undefined): string {
  if (!jid) return "";
  return jid.trim().toLowerCase();
}

// ============================================================================
// Sender Info
// ============================================================================

/**
 * Extract sender information from a WhatsApp message
 */
export function extractSenderInfo(msg: WAMessage): {
  id: string | undefined;
  name: string | undefined;
  isFromMe: boolean;
} {
  return {
    id: msg.key.participant ?? msg.key.remoteJid ?? undefined,
    name: msg.pushName ?? undefined,
    isFromMe: Boolean(msg.key.fromMe),
  };
}

// ============================================================================
// Formatting for Output
// ============================================================================

/**
 * Format a text message for WhatsApp
 */
export function formatTextMessage(text: string): { text: string } {
  return { text };
}

/**
 * Infer media type from file extension
 */
export function inferMediaType(filePath: string): "image" | "video" | "document" {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";

  const imageExts = ["png", "jpg", "jpeg", "gif", "webp"];
  const videoExts = ["mp4", "mov", "webm", "mkv", "avi"];

  if (imageExts.includes(ext)) return "image";
  if (videoExts.includes(ext)) return "video";
  return "document";
}

/**
 * Infer MIME type from file extension and type
 */
export function inferMimeType(
  filePath: string,
  kind: "image" | "video" | "document"
): string | undefined {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";

  if (kind === "image") {
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    return mimeMap[ext] ?? "image/png";
  }

  if (kind === "video") {
    const mimeMap: Record<string, string> = {
      mp4: "video/mp4",
      mov: "video/quicktime",
      webm: "video/webm",
      mkv: "video/x-matroska",
      avi: "video/x-msvideo",
    };
    return mimeMap[ext] ?? "video/mp4";
  }

  return undefined;
}

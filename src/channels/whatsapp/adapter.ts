/**
 * WhatsApp Channel Adapter
 *
 * Adapts the existing WhatsApp client to the multi-channel interface.
 * Handles message normalization, media, and session tracking.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { WAMessage, AnyMessageContent } from "@whiskeysockets/baileys";
import { areJidsSameUser } from "@whiskeysockets/baileys/lib/WABinary/jid-utils.js";

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";
import {
  extractTextFromMessage,
  extractMentions,
  extractSenderInfo,
  extractMediaInfo,
  hasKeywordMention,
  isGroupJid,
  isStatusJid,
  normalizeJid,
  inferMediaType,
  inferMimeType,
  toNormalizedMedia,
} from "./message-handler.js";

import { startWhatsApp, type WhatsAppClient } from "./client.js";
import type { AntConfig } from "../../config.js";

// ============================================================================
// Configuration
// ============================================================================

export interface WhatsAppAdapterConfig extends BaseAdapterConfig {
  /** ANT configuration */
  cfg: AntConfig;

  /** Optional callback for status updates */
  onStatusUpdate?: (status: {
    connection?: string;
    qr?: string;
    loggedOut?: boolean;
    statusCode?: number;
  }) => void;
}

// ============================================================================
// WhatsApp Adapter
// ============================================================================

export class WhatsAppAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "whatsapp";

  private readonly cfg: AntConfig;
  private readonly onStatusUpdate?: WhatsAppAdapterConfig["onStatusUpdate"];
  private client: WhatsAppClient | null = null;
  private selfJid: string | undefined;
  private selfLid: string | undefined;

  /** Track sent message IDs to avoid echo */
  private readonly sentMessageIds: Map<string, number> = new Map();

  constructor(config: WhatsAppAdapterConfig) {
    super(config);
    this.cfg = config.cfg;
    this.onStatusUpdate = config.onStatusUpdate;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    this.logger.info("Starting WhatsApp adapter...");

    this.client = await startWhatsApp({
      cfg: this.cfg,
      logger: this.logger,
      onMessage: async (inbound) => {
        // The existing client already does filtering, but we still normalize
        // This is a passthrough for now - raw message handling below
      },
      onStatus: (status) => {
        this.onStatusUpdate?.(status);

        if (status.connection === "open") {
          this.setConnected(true);
          this.selfJid = this.client?.getSelfJid();
        } else if (status.connection === "close") {
          this.setConnected(false, status.loggedOut ? "logged_out" : "disconnected");
        }
      },
    });

    // Set initial connection state
    this.setConnected(true);
    this.selfJid = this.client.getSelfJid();
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping WhatsApp adapter...");

    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    this.setConnected(false, "stopped");
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  async sendMessage(
    message: NormalizedMessage,
    options?: SendMessageOptions
  ): Promise<SendResult> {
    if (!this.client) {
      return { ok: false, error: "WhatsApp client not connected" };
    }

    const chatId = message.context.chatId;
    if (!chatId) {
      return { ok: false, error: "No chat ID specified" };
    }

    try {
      // Handle media if present
      if (message.media) {
        await this.sendMediaMessage(chatId, message);
      } else if (message.content) {
        await this.client.sendText(chatId, message.content);
      }

      // Track sent message
      const messageId = this.generateMessageId();
      this.sentMessageIds.set(messageId, Date.now());
      this.pruneSentMessageIds();

      return {
        ok: true,
        messageId,
        timestamp: Date.now(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ error, chatId }, "Failed to send WhatsApp message");
      return { ok: false, error };
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!this.client) return;
    await this.client.sendTyping(chatId, isTyping);
  }

  // ==========================================================================
  // Message Normalization
  // ==========================================================================

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const msg = rawMessage as WAMessage;

    // Extract basic info
    const text = extractTextFromMessage(msg);
    if (!text) return null;

    const chatId = msg.key.remoteJid;
    if (!chatId) return null;

    // Skip status broadcasts
    if (isStatusJid(chatId)) return null;

    const senderInfo = extractSenderInfo(msg);
    const isGroup = isGroupJid(chatId);

    // Check group permissions
    if (isGroup && !this.cfg.whatsapp.respondToGroups) return null;

    // Check self-only mode
    if (this.cfg.whatsapp.respondToSelfOnly) {
      const isSelf =
        (this.selfJid && areJidsSameUser(chatId, this.selfJid)) ||
        (this.selfLid && areJidsSameUser(chatId, this.selfLid));
      if (!isSelf) return null;
    }

    // Check fromMe filtering
    if (senderInfo.isFromMe) {
      if (!this.cfg.whatsapp.allowSelfMessages && !this.cfg.whatsapp.respondToSelfOnly) {
        return null;
      }
      // Skip our own sent messages
      if (msg.key.id && this.sentMessageIds.has(msg.key.id)) {
        return null;
      }
    }

    // Check mention requirements for groups
    if (isGroup && this.cfg.whatsapp.mentionOnly) {
      const mentions = extractMentions(msg);
      const botMentioned = this.selfJid ? mentions.includes(this.selfJid) : false;
      const nameMentioned = this.cfg.whatsapp.botName
        ? text.toLowerCase().includes(this.cfg.whatsapp.botName.toLowerCase())
        : false;
      const keywordMentioned = hasKeywordMention(text, this.cfg.whatsapp.mentionKeywords);

      if (!botMentioned && !nameMentioned && !keywordMentioned) {
        return null;
      }
    }

    // Check owner restrictions
    if (!this.isAllowedOwner(senderInfo.id, chatId)) {
      return null;
    }

    // Build session key
    const sessionKey = this.generateSessionKey(
      isGroup ? "group" : "dm",
      chatId
    );

    // Extract media if present
    const mediaInfo = extractMediaInfo(msg);
    const media = mediaInfo ? toNormalizedMedia(mediaInfo) : undefined;

    return this.createNormalizedMessage({
      id: msg.key.id ?? this.generateMessageId(),
      content: text,
      sender: {
        id: senderInfo.id ?? "unknown",
        name: senderInfo.name ?? "Unknown",
        isAgent: senderInfo.isFromMe,
      },
      context: {
        sessionKey,
        chatId,
      },
      media,
      timestamp: Number(msg.messageTimestamp ?? Date.now()),
      priority: this.defaultPriority,
      rawMessage: msg,
    });
  }

  protected formatOutgoing(message: NormalizedMessage): AnyMessageContent {
    if (message.media) {
      // Media message formatting is handled in sendMediaMessage
      return { text: message.content || "" };
    }
    return { text: message.content };
  }

  // ==========================================================================
  // Public API Extensions
  // ==========================================================================

  /**
   * Process a raw WhatsApp message and emit normalized message event
   */
  processRawMessage(msg: WAMessage): void {
    this.handleIncomingMessage(msg);
  }

  /**
   * Get the self JID (bot's own WhatsApp ID)
   */
  getSelfJid(): string | undefined {
    return this.selfJid ?? this.client?.getSelfJid();
  }

  /**
   * Get the underlying WhatsApp client
   */
  getClient(): WhatsAppClient | null {
    return this.client;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async sendMediaMessage(
    chatId: string,
    message: NormalizedMessage
  ): Promise<void> {
    if (!this.client || !message.media) return;

    const media = message.media;
    let filePath: string;

    // Resolve media data to file path
    if (Buffer.isBuffer(media.data)) {
      // Write buffer to temp file
      const tmpDir = path.join(this.cfg.resolved.stateDir, "outbound");
      await fs.mkdir(tmpDir, { recursive: true });
      const ext = this.getExtFromMimeType(media.mimeType);
      filePath = path.join(tmpDir, `media-${Date.now()}${ext}`);
      await fs.writeFile(filePath, media.data);
    } else if (typeof media.data === "string") {
      filePath = media.data;
    } else {
      throw new Error("Invalid media data type");
    }

    const type = inferMediaType(filePath);
    await this.client.sendMedia(chatId, {
      filePath,
      type,
      caption: message.content || undefined,
    });
  }

  private getExtFromMimeType(mimeType?: string): string {
    if (!mimeType) return "";
    const map: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
      "audio/ogg": ".ogg",
      "audio/mpeg": ".mp3",
    };
    return map[mimeType] ?? "";
  }

  private isAllowedOwner(senderId?: string, chatId?: string): boolean {
    const ownerJids = this.cfg.whatsapp.ownerJids;
    if (!ownerJids || ownerJids.length === 0) return true;

    const normalized = new Set(ownerJids.map(normalizeJid));
    const sender = normalizeJid(senderId);
    const chat = normalizeJid(chatId);

    return Boolean(sender && normalized.has(sender)) || Boolean(chat && normalized.has(chat));
  }

  private pruneSentMessageIds(): void {
    const cutoff = Date.now() - 5 * 60_000; // 5 minutes
    for (const [id, ts] of this.sentMessageIds.entries()) {
      if (ts < cutoff) this.sentMessageIds.delete(id);
    }
  }

  protected override generateSessionKey(type: string, chatId: string): string {
    return `whatsapp:${type}:${chatId}`;
  }
}

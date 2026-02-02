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

import { getEventStream, createEventPublishers } from "../../monitor/event-stream.js";
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
  /** Track sent message text to avoid echo loops */
  private readonly sentMessageTexts: Map<string, number> = new Map();
  private readonly maxEchoItems = 100;
  
  private events = createEventPublishers(getEventStream());

  constructor(config: WhatsAppAdapterConfig) {
    super(config);
    this.cfg = config.cfg;
    this.onStatusUpdate = config.onStatusUpdate;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /** Track consecutive connection errors for auto-reconnect decisions */
  private consecutiveErrors = 0;
  private lastErrorAt?: number;

  async start(): Promise<void> {
    this.logger.info("Starting WhatsApp adapter...");

    try {
      this.client = await startWhatsApp({
        cfg: this.cfg,
        logger: this.logger,
        onMessage: async (inbound) => {
          // Process incoming messages through the adapter's normalization pipeline
          this.handleIncomingMessage(inbound.message);
        },
        onStatus: (status) => {
          this.onStatusUpdate?.(status);

          if (status.connection === "open") {
            this.setConnected(true);
            this.selfJid = this.client?.getSelfJid();
            // Reset error counter on successful connection
            this.consecutiveErrors = 0;
            this.lastErrorAt = undefined;
          } else if (status.connection === "close") {
            const reason = status.loggedOut ? "logged_out" : "disconnected";
            this.setConnected(false, reason);
            
            // Emit adapter error for unexpected disconnections (not manual logout)
            if (!status.loggedOut) {
              this.consecutiveErrors++;
              this.lastErrorAt = Date.now();
              this.emit("adapter-error", {
                type: "error",
                error: "connection_closed",
                message: "WhatsApp connection closed unexpectedly",
                context: { 
                  statusCode: status.statusCode,
                  consecutiveErrors: this.consecutiveErrors,
                  shouldReconnect: this.consecutiveErrors < 5,
                },
              });
            }
          }
        },
        onError: (error) => {
          this.consecutiveErrors++;
          this.lastErrorAt = Date.now();
          
          this.logger.warn({ 
            error: error.message, 
            consecutiveErrors: this.consecutiveErrors 
          }, "WhatsApp socket error");

          // Emit adapter error event for socket errors
          this.emit("adapter-error", {
            type: "error",
            error: "socket_error",
            message: error.message,
            context: {
              consecutiveErrors: this.consecutiveErrors,
              lastErrorAt: this.lastErrorAt,
              shouldReconnect: this.consecutiveErrors < 5,
            },
          });
        },
      });

      // Listen for messages from the client (backup path)
      this.client.on("message", (inbound) => {
        this.handleIncomingMessage(inbound.message);
      });

      // Listen for socket-level errors
      this.client.on("error", (error: Error) => {
        this.consecutiveErrors++;
        this.lastErrorAt = Date.now();
        
        this.logger.warn({ 
          error: error.message, 
          consecutiveErrors: this.consecutiveErrors 
        }, "WhatsApp client error");

        this.emit("adapter-error", {
          type: "error",
          error: "client_error",
          message: error.message,
          context: {
            consecutiveErrors: this.consecutiveErrors,
            shouldReconnect: this.consecutiveErrors < 5,
          },
        });
      });

      // Set initial connection state
      this.setConnected(true);
      this.selfJid = this.client.getSelfJid();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.consecutiveErrors++;
      this.lastErrorAt = Date.now();
      
      this.logger.error({ error: errorMessage }, "Failed to start WhatsApp adapter");

      // Emit adapter error for initialization failures
      this.emit("adapter-error", {
        type: "error",
        error: "initialization_failed",
        message: `Failed to start WhatsApp adapter: ${errorMessage}`,
        context: {
          consecutiveErrors: this.consecutiveErrors,
          shouldReconnect: this.consecutiveErrors < 3,
        },
      });

      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping WhatsApp adapter...");

    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    this.setConnected(false, "stopped");
  }

  getStatus(): Record<string, any> {
      if (!this.client) {
          return { connected: false, message: "Client not initialized" };
      }
      return {
          connected: this.client.isConnected(),
          selfJid: this.client.getSelfJid(),
          ...this.client.getStatus(),
      };
  }

  /**
   * Check if WhatsApp is connected
   */
  isConnected(): boolean {
    return this.client?.isConnected() ?? false;
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================
  async sendMessage(
    message: NormalizedMessage,
    _options?: SendMessageOptions
  ): Promise<SendResult> {
    this.logger.info({
      sessionKey: message.context.sessionKey,
      chatId: message.context.chatId,
      contentLength: message.content?.length || 0,
      contentPreview: message.content?.slice(0, 200) || "(empty)",
      hasMedia: !!message.media,
      clientConnected: !!this.client,
    }, "WhatsApp adapter sendMessage called");
    
    if (!this.client) {
      this.logger.warn("WhatsApp client not connected");
      return { ok: false, error: "WhatsApp client not connected" };
    }

    const chatId = message.context.chatId;
    if (!chatId) {
      this.logger.warn("No chat ID specified");
      return { ok: false, error: "No chat ID specified" };
    }

    try {
      if (this.cfg.whatsapp.typingIndicator) {
        await this.sendTyping(chatId, true);
      }

      // Handle media if present
      this.logger.info({ hasContent: !!message.content, hasMedia: !!message.media }, "WhatsApp adapter: about to send");
      const result = message.media
        ? await this.sendMediaMessage(chatId, message)
        : message.content
          ? await this.client.sendText(chatId, message.content)
          : undefined;
      
      this.logger.info({ result: result ? "success" : "undefined", messageId: result?.key?.id }, "WhatsApp adapter: send result");

      // Track sent message
      const messageId = result?.key?.id ?? this.generateMessageId();
      this.sentMessageIds.set(messageId, Date.now());
      this.rememberSentText(message.content);
      this.pruneSentMessageIds();

      return {
        ok: true,
        messageId,
        timestamp: Date.now(),
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ error, chatId }, "Failed to send WhatsApp message");

      // Publish error event
      await this.events.errorOccurred({
          errorType: "send_message_failed",
          severity: "high",
          message: `Failed to send to ${chatId}: ${error}`,
          context: { chatId }
      }, { sessionKey: message.context.sessionKey, channel: this.channel });

      return { ok: false, error };
    } finally {
      if (this.cfg.whatsapp.typingIndicator) {
        await this.sendTyping(chatId, false);
      }
    }
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!this.client) return;
    await this.client.sendTyping(chatId, isTyping);
  }

  /**
   * Send a simple text message directly to a JID
   */
  async sendText(jid: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error("WhatsApp client not connected");
    }
    await this.client.sendText(jid, text);
  }

  // ==========================================================================
  // Message Normalization
  // ==========================================================================

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const msg = rawMessage as WAMessage;

    // Log ALL incoming messages for debugging
    this.logger.info({
      chatId: msg.key?.remoteJid,
      msgId: msg.key?.id,
      fromMe: Boolean(msg.key?.fromMe),
      selfJid: this.selfJid,
      hasContent: !!msg.message,
    }, "WhatsApp: Raw message received");

    // Extract basic info
    const text = extractTextFromMessage(msg);
    if (text) {
      this.logger.info({ chatId: msg.key?.remoteJid, msgId: msg.key?.id, preview: text.slice(0, 80), fromMe: Boolean(msg.key?.fromMe) }, "WhatsApp message received");
    }
    if (!text) {
      this.logger.info("Message filtered: no text content");
      return null;
    }

    if (this.isEchoText(text)) {
     // this.logger.debug({ preview: text.slice(0, 80) }, "Message filtered: echo");
      this.forgetEchoText(text);
      return null;
    }

    const chatId = msg.key.remoteJid;
    if (!chatId) {
      this.logger.debug("Message filtered: no chat ID");
      return null;
    }

    // Skip status broadcasts
    if (isStatusJid(chatId)) {
      this.logger.debug({ chatId }, "Message filtered: status broadcast");
      return null;
    }

    const senderInfo = extractSenderInfo(msg);
    const isGroup = isGroupJid(chatId);

    // Check group permissions
    if (isGroup && !this.cfg.whatsapp.respondToGroups) {
      this.logger.debug({ chatId, isGroup }, "Message filtered: group messages disabled");
      return null;
    }

    // Check self-only mode
    if (this.cfg.whatsapp.respondToSelfOnly) {
      const isSelf =
        (this.selfJid && areJidsSameUser(chatId, this.selfJid)) ||
        (this.selfLid && areJidsSameUser(chatId, this.selfLid));
      this.logger.info({ chatId, selfJid: this.selfJid, selfLid: this.selfLid, isSelf, respondToSelfOnly: this.cfg.whatsapp.respondToSelfOnly }, "WhatsApp: Checking self-chat mode");
      if (!isSelf) {
        this.logger.info({ chatId, selfJid: this.selfJid }, "Message filtered: not self-chat");
        return null;
      }
      this.logger.info({ chatId }, "Message accepted: self-chat");
    }

    // Check fromMe filtering
    if (senderInfo.isFromMe) {
      if (!this.cfg.whatsapp.allowSelfMessages && !this.cfg.whatsapp.respondToSelfOnly) {
        this.logger.debug("Message filtered: fromMe not allowed");
        return null;
      }
      // Skip our own sent messages
      if (msg.key.id && this.sentMessageIds.has(msg.key.id)) {
        this.logger.debug({ msgId: msg.key.id }, "Message filtered: own sent message");
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
        this.logger.debug({ text }, "Message filtered: no mention");
        return null;
      }
    }

    // Check owner restrictions
    if (!this.isAllowedOwner(senderInfo.id, chatId)) {
      this.logger.debug({ senderId: senderInfo.id, chatId }, "Message filtered: not allowed owner");
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

    const timestamp = msg.messageTimestamp 
      ? (typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000 
      : Date.now();

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
      timestamp,
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
  ): Promise<WAMessage | undefined> {
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
    return this.client.sendMedia(chatId, {
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

  private rememberSentText(text?: string): void {
    if (!text) return;
    this.sentMessageTexts.set(this.normalizeEchoText(text), Date.now());
    this.pruneSentMessageTexts();
  }

  private isEchoText(text: string): boolean {
    return this.sentMessageTexts.has(this.normalizeEchoText(text));
  }

  private forgetEchoText(text: string): void {
    this.sentMessageTexts.delete(this.normalizeEchoText(text));
  }

  private normalizeEchoText(text: string): string {
    return text.trim();
  }

  private pruneSentMessageTexts(): void {
    if (this.sentMessageTexts.size <= this.maxEchoItems) {
      return;
    }
    const sortedEntries = Array.from(this.sentMessageTexts.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = sortedEntries.length - this.maxEchoItems;
    for (let i = 0; i < toRemove; i += 1) {
      const key = sortedEntries[i]?.[0];
      if (key) {
        this.sentMessageTexts.delete(key);
      }
    }
  }

  protected override generateSessionKey(type: string, chatId: string): string {
    return `whatsapp:${type}:${chatId}`;
  }
}

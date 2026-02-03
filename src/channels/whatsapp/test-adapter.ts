/**
 * Test WhatsApp Adapter
 *
 * A lightweight WhatsApp adapter for programmatic testing and local harnesses.
 * - No network / Baileys dependency at runtime
 * - Allows injecting inbound messages
 * - Records outbound messages and typing updates for assertions
 *
 * Enabled by `NODE_ENV=test` in the runtime start command.
 */

import { randomUUID } from "node:crypto";

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";
import { hasKeywordMention, isGroupJid, isStatusJid, normalizeJid } from "./message-handler.js";
import type { AntConfig } from "../../config.js";

export interface TestWhatsAppInboundMessage {
  chatId: string;
  text: string;
  senderId?: string;
  pushName?: string;
  fromMe?: boolean;
  mentions?: string[];
  timestampMs?: number;
}

export interface TestWhatsAppOutboundMessage {
  id: string;
  chatId: string;
  sessionKey: string;
  content: string;
  media?: NormalizedMessage["media"];
  timestamp: number;
}

export interface TestWhatsAppTypingEvent {
  chatId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface TestWhatsAppAdapterConfig extends BaseAdapterConfig {
  cfg: AntConfig;
  /** Pretend "self" JID for respondToSelfOnly filtering (defaults to env or a safe placeholder). */
  selfJid?: string;
}

export class TestWhatsAppAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "whatsapp";

  private readonly cfg: AntConfig;
  private readonly selfJid: string;
  private readonly outbound: TestWhatsAppOutboundMessage[] = [];
  private readonly typingEvents: TestWhatsAppTypingEvent[] = [];

  constructor(config: TestWhatsAppAdapterConfig) {
    super(config);
    this.initLogger(config);
    this.cfg = config.cfg;
    this.selfJid =
      normalizeJid(config.selfJid) ||
      normalizeJid(process.env.ANT_TEST_WHATSAPP_SELF_JID) ||
      "test-self@s.whatsapp.net";
  }

  async start(): Promise<void> {
    this.setConnected(true);
  }

  async stop(): Promise<void> {
    this.setConnected(false, "stopped");
  }

  getStatus(): Record<string, any> {
    return {
      connected: this.connected,
      mode: "test",
      selfJid: this.selfJid,
      outboundCount: this.outbound.length,
      typingCount: this.typingEvents.length,
    };
  }

  async sendMessage(message: NormalizedMessage, _options?: SendMessageOptions): Promise<SendResult> {
    const chatId = message.context.chatId;
    if (!chatId) {
      return { ok: false, error: "Missing chatId in message context" };
    }

    const record: TestWhatsAppOutboundMessage = {
      id: message.id || randomUUID(),
      chatId,
      sessionKey: message.context.sessionKey,
      content: message.content ?? "",
      media: message.media,
      timestamp: message.timestamp ?? Date.now(),
    };
    this.outbound.push(record);

    this.logger.info(
      {
        chatId,
        sessionKey: message.context.sessionKey,
        contentLength: record.content.length,
        contentPreview: record.content.slice(0, 200) || "(empty)",
        hasMedia: Boolean(record.media),
        outboundCount: this.outbound.length,
      },
      "TestWhatsAppAdapter recorded outbound message"
    );

    return { ok: true, messageId: record.id, timestamp: record.timestamp };
  }

  /**
   * Router typing indicator hook (WhatsApp-specific extension)
   */
  async sendTyping(chatId: string, isTyping: boolean): Promise<void> {
    this.typingEvents.push({ chatId, isTyping, timestamp: Date.now() });
  }

  /**
   * Convenience helper used by main agent integration (mirrors WhatsAppAdapter API).
   */
  async sendText(jid: string, text: string): Promise<void> {
    const sessionKey = this.generateSessionKey("dm", jid);
    await this.sendMessage({
      id: randomUUID(),
      channel: this.channel,
      sender: { id: "agent", name: "Agent", isAgent: true },
      content: text,
      context: { sessionKey, chatId: jid },
      timestamp: Date.now(),
      priority: "normal",
    });
  }

  /**
   * Inject an inbound message into the adapter normalization pipeline.
   */
  injectInbound(
    message: TestWhatsAppInboundMessage
  ): { accepted: boolean; sessionKey?: string; messageId?: string } {
    const normalized = this.normalizeIncoming(message);
    if (!normalized) {
      return { accepted: false };
    }

    if (this.enableSessionTracking) {
      this.updateSession(normalized);
    }

    this.emitEvent({ type: "message", message: normalized });
    return { accepted: true, sessionKey: normalized.context.sessionKey, messageId: normalized.id };
  }

  getOutbound(): TestWhatsAppOutboundMessage[] {
    return [...this.outbound];
  }

  clearOutbound(): void {
    this.outbound.length = 0;
  }

  getTypingEvents(): TestWhatsAppTypingEvent[] {
    return [...this.typingEvents];
  }

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const msg = rawMessage as Partial<TestWhatsAppInboundMessage> | null;
    const chatId = typeof msg?.chatId === "string" ? msg.chatId.trim() : "";
    const text = typeof msg?.text === "string" ? msg.text : "";

    if (!chatId) return null;
    if (isStatusJid(chatId)) return null;
    if (!text.trim()) return null;

    const isGroup = isGroupJid(chatId);

    if (isGroup && !this.cfg.whatsapp.respondToGroups) {
      return null;
    }

    // Self-chat gating
    if (this.cfg.whatsapp.respondToSelfOnly) {
      if (normalizeJid(chatId) !== this.selfJid) {
        return null;
      }
    }

    // Group mention gating (DMs do not require mention)
    if (isGroup && this.cfg.whatsapp.mentionOnly) {
      const mentions = Array.isArray(msg?.mentions) ? msg!.mentions!.map(normalizeJid) : [];
      const botMentioned = mentions.includes(this.selfJid);
      const nameMentioned = this.cfg.whatsapp.botName
        ? text.toLowerCase().includes(this.cfg.whatsapp.botName.toLowerCase())
        : false;
      const keywordMentioned = hasKeywordMention(text, this.cfg.whatsapp.mentionKeywords);

      if (!botMentioned && !nameMentioned && !keywordMentioned) {
        return null;
      }
    }

    // Owner restrictions
    if (this.cfg.whatsapp.ownerJids?.length) {
      const owners = new Set(this.cfg.whatsapp.ownerJids.map(normalizeJid));
      const sender = normalizeJid(msg?.senderId);
      const chat = normalizeJid(chatId);
      if (!owners.has(sender) && !owners.has(chat)) {
        return null;
      }
    }

    const senderId = msg?.senderId || "tester@s.whatsapp.net";
    const pushName = msg?.pushName || "Tester";
    const fromMe = Boolean(msg?.fromMe);
    const timestamp = typeof msg?.timestampMs === "number" ? msg!.timestampMs! : Date.now();
    const sessionKey = this.generateSessionKey(isGroup ? "group" : "dm", chatId);

    return this.createNormalizedMessage({
      id: this.generateMessageId(),
      content: text,
      sender: { id: senderId, name: pushName, isAgent: fromMe },
      context: { sessionKey, chatId },
      timestamp,
      priority: this.defaultPriority,
      rawMessage,
    });
  }

  protected formatOutgoing(_message: NormalizedMessage): unknown {
    // Not used in test adapter
    return {};
  }

  protected override generateSessionKey(type: string, chatId: string): string {
    return `whatsapp:${type}:${chatId}`;
  }
}

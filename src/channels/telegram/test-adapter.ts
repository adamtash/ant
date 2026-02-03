/**
 * Test Telegram Adapter
 *
 * A lightweight Telegram adapter for programmatic testing and local harnesses.
 * - No network dependency
 * - Allows injecting inbound messages
 * - Records outbound messages and typing updates for assertions
 */

import { randomUUID } from "node:crypto";

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";

import type { AntConfig } from "../../config.js";
import { hasKeywordMention } from "./message-handler.js";
import { normalizeAllowEntry } from "./pairing-store.js";

export interface TestTelegramInboundMessage {
  chatId: string;
  text: string;
  senderId?: string;
  username?: string;
  isGroup?: boolean;
  threadId?: string;
  timestampMs?: number;
}

export interface TestTelegramOutboundMessage {
  id: string;
  chatId: string;
  threadId?: string;
  sessionKey: string;
  content: string;
  media?: NormalizedMessage["media"];
  timestamp: number;
}

export interface TestTelegramTypingEvent {
  chatId: string;
  isTyping: boolean;
  timestamp: number;
}

export interface TestTelegramAdapterConfig extends BaseAdapterConfig {
  cfg: AntConfig;
}

export class TestTelegramAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "telegram";

  private readonly cfg: AntConfig;
  private readonly outbound: TestTelegramOutboundMessage[] = [];
  private readonly typingEvents: TestTelegramTypingEvent[] = [];

  constructor(config: TestTelegramAdapterConfig) {
    super(config);
    this.initLogger(config);
    this.cfg = config.cfg;
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
      outboundCount: this.outbound.length,
      typingCount: this.typingEvents.length,
    };
  }

  async sendMessage(message: NormalizedMessage, _options?: SendMessageOptions): Promise<SendResult> {
    const chatId = message.context.chatId;
    if (!chatId) {
      return { ok: false, error: "Missing chatId in message context" };
    }

    const record: TestTelegramOutboundMessage = {
      id: message.id || randomUUID(),
      chatId,
      threadId: message.context.threadId,
      sessionKey: message.context.sessionKey,
      content: message.content ?? "",
      media: message.media,
      timestamp: message.timestamp ?? Date.now(),
    };
    this.outbound.push(record);
    return { ok: true, messageId: record.id, timestamp: record.timestamp };
  }

  async sendTyping(chatId: string, isTyping: boolean): Promise<void> {
    this.typingEvents.push({ chatId, isTyping, timestamp: Date.now() });
  }

  injectInbound(
    message: TestTelegramInboundMessage
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

  getOutbound(): TestTelegramOutboundMessage[] {
    return [...this.outbound];
  }

  clearOutbound(): void {
    this.outbound.length = 0;
  }

  getTypingEvents(): TestTelegramTypingEvent[] {
    return [...this.typingEvents];
  }

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const msg = rawMessage as Partial<TestTelegramInboundMessage> | null;
    const chatId = typeof msg?.chatId === "string" ? msg.chatId.trim() : "";
    const text = typeof msg?.text === "string" ? msg.text : "";
    if (!chatId) return null;
    if (!text.trim()) return null;

    const isGroup = Boolean(msg?.isGroup);

    if (isGroup && !this.cfg.telegram?.respondToGroups) {
      return null;
    }

    if (isGroup && this.cfg.telegram?.mentionOnly) {
      const botNameMentioned = this.cfg.telegram?.botName
        ? text.toLowerCase().includes(this.cfg.telegram.botName.toLowerCase())
        : false;
      const keywordMentioned = hasKeywordMention(text, this.cfg.telegram?.mentionKeywords ?? []);
      if (!botNameMentioned && !keywordMentioned) {
        return null;
      }
    }

    // DM allowlist (pairing is out-of-scope for the test adapter)
    if (!isGroup && (this.cfg.telegram?.dmPolicy === "allowlist" || this.cfg.telegram?.dmPolicy === "pairing")) {
      const allowFrom = (this.cfg.telegram?.allowFrom ?? []).map(normalizeAllowEntry).filter(Boolean);
      if (allowFrom.length > 0) {
        const allowed = new Set(allowFrom.map((v) => v.toLowerCase()));
        const senderId = String(msg?.senderId ?? "").trim();
        const username = msg?.username ? normalizeAllowEntry(msg.username) : "";
        if (!allowed.has(senderId.toLowerCase()) && (!username || !allowed.has(username.toLowerCase()))) {
          return null;
        }
      }
    }

    const senderId = msg?.senderId || "tester";
    const username = msg?.username ? msg.username : undefined;
    const isAgent = false;
    const timestamp = typeof msg?.timestampMs === "number" ? msg!.timestampMs! : Date.now();
    const sessionKey = isGroup
      ? (msg?.threadId ? `telegram:topic:${chatId}:${msg.threadId}` : `telegram:group:${chatId}`)
      : `telegram:dm:${chatId}`;

    return this.createNormalizedMessage({
      id: this.generateMessageId(),
      content: text,
      sender: { id: senderId, name: username ? `@${username}` : "Tester", isAgent },
      context: { sessionKey, chatId, threadId: msg?.threadId },
      timestamp,
      priority: this.defaultPriority,
      rawMessage,
    });
  }

  protected formatOutgoing(_message: NormalizedMessage): unknown {
    return {};
  }
}


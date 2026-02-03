/**
 * Telegram Channel Adapter
 *
 * grammY-based adapter for Telegram Bot API.
 * Supports:
 * - Polling mode (local/dev)
 * - Webhook mode (public) via gateway Express route
 * - Secure-by-default DM access control (pairing/allowlist/open/disabled)
 * - Group mention gating
 * - Forum topic sessions via message_thread_id
 * - Outbound message splitting (Telegram limits)
 */

import { Bot, InputFile } from "grammy";
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";

import type { AntConfig } from "../../config.js";
import {
  extractTextFromMessage,
  hasKeywordMention,
  hasMentionOfUser,
  isGroupChatType,
  getSenderLabel,
} from "./message-handler.js";
import {
  isTelegramAllowedSender,
  upsertTelegramPairingRequest,
} from "./pairing-store.js";

// ============================================================================
// Configuration
// ============================================================================

export interface TelegramAdapterConfig extends BaseAdapterConfig {
  /** ANT configuration */
  cfg: AntConfig;
}

// ============================================================================
// Telegram Adapter
// ============================================================================

export class TelegramAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "telegram";

  private readonly cfg: AntConfig;
  private botToken?: string;
  private bot: Bot | null = null;

  private selfId?: number;
  private selfUsername?: string;

  private lastStartAt?: number;
  private lastError?: string;
  private connectedAt?: number;
  private messageCount = 0;
  private lastMessageAt?: number;

  constructor(config: TelegramAdapterConfig) {
    super(config);
    this.initLogger(config);
    this.cfg = config.cfg;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    const telegramCfg = this.cfg.telegram;
    const token = telegramCfg?.botToken?.trim();
    if (!token) {
      throw new Error("Telegram botToken is not configured");
    }
    this.botToken = token;

    this.lastStartAt = Date.now();
    this.logger.info({ mode: telegramCfg?.mode }, "Starting Telegram adapter...");

    const bot = new Bot(token);
    this.bot = bot;

    bot.catch((err) => {
      const error = err?.error instanceof Error ? err.error : err;
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.logger.warn({ error: message }, "Telegram bot error");
      this.emitEvent({
        type: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });

    bot.on("message", async (ctx) => {
      await this.onMessage(ctx);
    });

    const me = await bot.api.getMe();
    this.selfId = me.id;
    this.selfUsername = me.username ?? undefined;

    if (telegramCfg?.mode === "webhook") {
      await this.startWebhookMode();
    } else {
      await this.startPollingMode();
    }

    this.connectedAt = Date.now();
    this.setConnected(true);
    this.logger.info(
      { selfId: this.selfId, selfUsername: this.selfUsername, mode: telegramCfg?.mode },
      "Telegram adapter started"
    );
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop();
      } catch {
        // ignore
      }
      this.bot = null;
    }
    this.setConnected(false, "stopped");
  }

  getStatus(): Record<string, any> {
    const telegramCfg = this.cfg.telegram;
    const configured = Boolean(telegramCfg?.botToken?.trim());
    const mode = telegramCfg?.mode ?? "polling";
    const dmPolicy = telegramCfg?.dmPolicy ?? "pairing";
    const pairingUrl = this.selfUsername ? `https://t.me/${this.selfUsername}` : undefined;

    return {
      enabled: Boolean(telegramCfg?.enabled),
      configured,
      connected: this.isConnected(),
      mode,
      dmPolicy,
      selfId: this.selfId,
      selfUsername: this.selfUsername,
      pairingUrl,
      // Reuse `qr` for UI convenience (not a login QR like WhatsApp).
      qr: pairingUrl,
      connectedAt: this.connectedAt,
      lastStartAt: this.lastStartAt,
      lastError: this.lastError,
      messageCount: this.messageCount,
      lastMessageAt: this.lastMessageAt,
      webhookPath: telegramCfg?.webhook?.path ?? "/api/telegram/webhook",
    };
  }

  // ==========================================================================
  // Webhook Handler (called by gateway Express route)
  // ==========================================================================

  async handleWebhook(req: Request, res: Response): Promise<void> {
    if (!this.bot) {
      res.status(503).json({ ok: false, error: "Telegram bot not initialized" });
      return;
    }

    const telegramCfg = this.cfg.telegram;
    if (telegramCfg?.mode !== "webhook") {
      res.status(409).json({ ok: false, error: "Telegram is not running in webhook mode" });
      return;
    }

    const expectedSecret = telegramCfg.webhook?.secretToken?.trim();
    if (expectedSecret) {
      const actual = typeof req.headers["x-telegram-bot-api-secret-token"] === "string"
        ? req.headers["x-telegram-bot-api-secret-token"]
        : Array.isArray(req.headers["x-telegram-bot-api-secret-token"])
          ? req.headers["x-telegram-bot-api-secret-token"][0]
          : undefined;
      if (!actual || actual !== expectedSecret) {
        res.status(401).json({ ok: false, error: "invalid telegram secret token" });
        return;
      }
    }

    const update = req.body;
    if (!update || typeof update !== "object") {
      res.status(400).json({ ok: false, error: "invalid telegram update" });
      return;
    }

    try {
      await this.bot.handleUpdate(update as any);
      res.json({ ok: true });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, error: this.lastError });
    }
  }

  // ==========================================================================
  // Sending
  // ==========================================================================

  async sendMessage(
    message: NormalizedMessage,
    _options?: SendMessageOptions
  ): Promise<SendResult> {
    if (!this.bot) {
      return { ok: false, error: "Telegram bot not initialized" };
    }

    const { chatId, threadId } = this.resolveChatAndThread(message);
    if (!chatId) {
      return { ok: false, error: "Missing chatId for Telegram send" };
    }

    const messageThreadId = threadId ? parseInt(threadId, 10) : undefined;
    const disablePreview = this.cfg.telegram?.linkPreview === false;

    try {
      if (message.media) {
        const caption = (message.content ?? "").trim();
        const captionParts = splitTelegramText(caption, 1024);

        const input = this.toInputFile(message.media.data, message.media.filename);
        const opts: any = {
          caption: captionParts[0] || undefined,
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        };

        switch (message.media.type) {
          case "image":
            await this.bot.api.sendPhoto(chatId, input, opts);
            break;
          case "video":
            await this.bot.api.sendVideo(chatId, input, opts);
            break;
          case "audio":
            await this.bot.api.sendAudio(chatId, input, opts);
            break;
          case "file":
          default:
            await this.bot.api.sendDocument(chatId, input, opts);
            break;
        }

        // Any remaining caption parts are sent as follow-up messages.
        for (const part of captionParts.slice(1)) {
          if (!part) continue;
          await this.bot.api.sendMessage(chatId, part, {
            ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
            ...(disablePreview ? { disable_web_page_preview: true } : {}),
          } as any);
        }

        return { ok: true, messageId: message.id };
      }

      const content = (message.content ?? "").trim();
      if (!content) {
        return { ok: true, messageId: message.id };
      }

      const parts = splitTelegramText(content, 4096);
      for (const part of parts) {
        if (!part) continue;
        await this.bot.api.sendMessage(chatId, part, {
          ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
          ...(disablePreview ? { disable_web_page_preview: true } : {}),
        } as any);
      }

      return { ok: true, messageId: message.id };
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      return { ok: false, error: this.lastError };
    }
  }

  async sendTyping(chatId: string, isTyping: boolean): Promise<void> {
    if (!this.bot) return;
    if (!this.cfg.telegram?.typingIndicator) return;
    if (!isTyping) return;
    await this.bot.api.sendChatAction(chatId, "typing");
  }

  // ==========================================================================
  // Normalization
  // ==========================================================================

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    const ctx = rawMessage as Context | undefined;
    const msg = ctx?.message as Message | undefined;
    if (!msg) return null;

    const sender = msg.from;
    if (!sender) return null;
    if (sender.is_bot && this.selfId && sender.id === this.selfId) {
      return null;
    }

    const chat = msg.chat;
    const chatType = chat?.type;
    const isGroup = isGroupChatType(chatType);

    if (isGroup && !this.cfg.telegram?.respondToGroups) {
      return null;
    }

    const content = extractTextFromMessage(msg) ?? "";
    if (!content) return null;

    if (isGroup && this.cfg.telegram?.mentionOnly) {
      const hasMention = hasMentionOfUser({
        message: msg,
        username: this.selfUsername ?? this.cfg.telegram?.botName,
        userId: this.selfId,
      });
      const hasKeyword = hasKeywordMention(content, this.cfg.telegram?.mentionKeywords ?? []);
      const hasBotName = this.cfg.telegram?.botName
        ? content.toLowerCase().includes(this.cfg.telegram.botName.toLowerCase())
        : false;

      if (!hasMention && !hasKeyword && !hasBotName) {
        return null;
      }
    }

    const chatId = chat?.id !== undefined ? String(chat.id) : undefined;
    const threadId = msg.message_thread_id !== undefined ? String(msg.message_thread_id) : undefined;
    const sessionKey = this.buildSessionKey({ chatId, threadId, isGroup });

    this.messageCount += 1;
    this.lastMessageAt = Date.now();

    const attachedMedia = (ctx as any)?.state?.ant?.media as NormalizedMessage["media"] | undefined;

    return this.createNormalizedMessage({
      id: String(msg.message_id),
      content,
      media: attachedMedia,
      sender: {
        id: String(sender.id),
        name: getSenderLabel(sender),
        isAgent: false,
      },
      context: {
        sessionKey,
        chatId,
        threadId,
      },
      timestamp: (msg.date ?? Math.floor(Date.now() / 1000)) * 1000,
      rawMessage: msg,
    });
  }

  protected formatOutgoing(_message: NormalizedMessage): unknown {
    return {};
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async startPollingMode(): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not initialized");
    try {
      // If a webhook is set, polling will fail with conflicts.
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch {
      // ignore
    }
    await this.bot.start();
  }

  private async startWebhookMode(): Promise<void> {
    if (!this.bot) throw new Error("Telegram bot not initialized");
    const telegramCfg = this.cfg.telegram;
    const publicUrl = telegramCfg?.webhook?.publicUrl?.trim();
    const webhookPath = (telegramCfg?.webhook?.path ?? "/api/telegram/webhook").trim();
    if (!publicUrl) {
      throw new Error("Telegram webhook mode requires telegram.webhook.publicUrl");
    }
    const url = joinUrl(publicUrl, webhookPath);

    try {
      await this.bot.api.setWebhook(url, {
        secret_token: telegramCfg?.webhook?.secretToken?.trim(),
      } as any);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  private async onMessage(ctx: Context): Promise<void> {
    const msg = ctx.message as Message | undefined;
    if (!msg) return;

    const chat = msg.chat;
    const chatType = chat?.type;
    const isGroup = isGroupChatType(chatType);
    const isDm = chatType === "private";
    const sender = msg.from;
    const chatId = chat?.id !== undefined ? String(chat.id) : "";
    const senderId = sender?.id !== undefined ? String(sender.id) : "";
    const senderUsername = sender?.username ?? undefined;

    // Minimal native DM commands (safe even when locked down).
    if (isDm) {
      const rawText = (msg.text ?? msg.caption ?? "").trim();
      const cmd = rawText.startsWith("/") ? rawText.split(/\s+/, 1)[0] : "";

      if (cmd === "/id" || cmd === "/whoami") {
        await this.safeReply(ctx, [
          `Your Telegram user id: ${senderId || "unknown"}`,
          senderUsername ? `Username: @${senderUsername}` : undefined,
          chatId ? `Chat id: ${chatId}` : undefined,
        ].filter(Boolean).join("\n"));
        return;
      }

      if (cmd === "/help" || cmd === "/start") {
        await this.safeReply(ctx, this.buildHelpText());
        // Continue to access control for /start in case user includes a message payload.
        if (cmd === "/help") return;
      }

      if (cmd === "/pair") {
        if (!senderId || !chatId) {
          await this.safeReply(ctx, "Unable to start pairing (missing sender/chat id).");
          return;
        }
        const { request } = await upsertTelegramPairingRequest({
          cfg: this.cfg,
          userId: senderId,
          chatId,
          username: senderUsername ? `@${senderUsername}` : undefined,
        });
        await this.safeReply(ctx, this.buildPairingRequestText(request.code));
        return;
      }
    }

    // Access control
    if (isGroup) {
      if (!this.cfg.telegram?.respondToGroups) return;
      if (this.cfg.telegram?.downloadMedia) {
        await this.maybeAttachInboundMedia(ctx, msg);
      }
      this.handleIncomingMessage(ctx);
      return;
    }

    if (isDm) {
      const dmPolicy = this.cfg.telegram?.dmPolicy ?? "pairing";
      if (dmPolicy === "disabled") return;

      if (dmPolicy === "open") {
        if (this.cfg.telegram?.downloadMedia) {
          await this.maybeAttachInboundMedia(ctx, msg);
        }
        this.handleIncomingMessage(ctx);
        return;
      }

      // allowlist + pairing both require being allowed; pairing creates a request when missing.
      const allowed = await isTelegramAllowedSender({
        cfg: this.cfg,
        senderUserId: senderId,
        senderUsername: senderUsername ? `@${senderUsername}` : undefined,
      });

      if (allowed) {
        if (this.cfg.telegram?.downloadMedia) {
          await this.maybeAttachInboundMedia(ctx, msg);
        }
        this.handleIncomingMessage(ctx);
        return;
      }

      if (dmPolicy === "allowlist") {
        // One-way: don't auto-create pairing requests.
        await this.safeReply(ctx, "🔒 This bot is locked. Ask the admin to add your user id to the allowlist.");
        return;
      }

      // dmPolicy === "pairing"
      if (!senderId || !chatId) return;
      const { request, created } = await upsertTelegramPairingRequest({
        cfg: this.cfg,
        userId: senderId,
        chatId,
        username: senderUsername ? `@${senderUsername}` : undefined,
      });
      if (created) {
        await this.safeReply(ctx, this.buildPairingRequestText(request.code));
      }
      return;
    }

    // Unknown chat type: ignore.
  }

  private buildSessionKey(params: { chatId?: string; threadId?: string; isGroup: boolean }): string {
    const chatId = params.chatId?.trim();
    const threadId = params.threadId?.trim();

    if (!chatId) return `${this.channel}:unknown`;

    if (!params.isGroup) {
      return `${this.channel}:dm:${chatId}`;
    }

    // Forum topics become separate sessions.
    if (threadId) {
      return `${this.channel}:topic:${chatId}:${threadId}`;
    }

    return `${this.channel}:group:${chatId}`;
  }

  private resolveChatAndThread(message: NormalizedMessage): { chatId?: string; threadId?: string } {
    const chatId = message.context.chatId ?? this.parseChatIdFromSessionKey(message.context.sessionKey);
    const threadId = message.context.threadId ?? this.parseThreadIdFromSessionKey(message.context.sessionKey);
    return { chatId, threadId };
  }

  private parseChatIdFromSessionKey(sessionKey: string): string | undefined {
    const parts = sessionKey.split(":").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3) return undefined;

    const [_channel, type, ...rest] = parts;
    if (type === "topic") {
      return rest[0];
    }

    return rest.join(":") || undefined;
  }

  private parseThreadIdFromSessionKey(sessionKey: string): string | undefined {
    const parts = sessionKey.split(":").map((p) => p.trim()).filter(Boolean);
    if (parts.length < 4) return undefined;
    const [_channel, type, ...rest] = parts;
    if (type !== "topic") return undefined;
    return rest[1];
  }

  private toInputFile(data: Buffer | string, filename?: string): InputFile | string {
    if (typeof data === "string") return data;
    return new InputFile(data, filename);
  }

  private async safeReply(ctx: Context, text: string): Promise<void> {
    try {
      if (!text.trim()) return;
      await ctx.reply(text);
    } catch (err) {
      this.logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Telegram reply failed");
    }
  }

  private buildPairingRequestText(code: string): string {
    return [
      "🔐 This bot requires pairing before it will respond in DMs.",
      "",
      `Pairing code: ${code}`,
      "",
      "Ask the admin to approve this code in the ANT UI (Tunnels → Telegram) or via the gateway API.",
      "Tip: send /id to show your Telegram user id.",
    ].join("\n");
  }

  private buildHelpText(): string {
    const name = this.selfUsername ? `@${this.selfUsername}` : (this.cfg.telegram?.botName ?? "this bot");
    return [
      `Hello! I'm ${name}.`,
      "",
      "Commands:",
      "/id - show your Telegram user id",
      "/pair - request pairing access (admin approval required)",
      "/help - show this message",
    ].join("\n");
  }

  private async maybeAttachInboundMedia(ctx: Context, msg: Message): Promise<void> {
    if (!this.bot || !this.botToken) return;
    const media = await this.tryDownloadInboundMedia(msg);
    if (!media) return;
    const state = ((ctx as any).state ??= {});
    const ant = (state.ant ??= {});
    ant.media = media;
  }

  private async tryDownloadInboundMedia(msg: Message): Promise<NormalizedMessage["media"] | null> {
    if (!this.bot || !this.botToken) return null;

    const maxBytes = this.cfg.telegram?.maxInboundMediaBytes ?? 20_000_000;
    const dir = path.join(this.cfg.resolved.telegramStateDir, "inbound");
    await fs.mkdir(dir, { recursive: true });

    const selected:
      | { type: NonNullable<NormalizedMessage["media"]>["type"]; fileId: string; filenameHint?: string; mimeType?: string }
      | null = (() => {
      if (msg.photo?.length) {
        const best = msg.photo.slice().sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0]!;
        return { type: "image", fileId: best.file_id, filenameHint: "photo.jpg", mimeType: "image/jpeg" };
      }
      if (msg.video) {
        return { type: "video", fileId: msg.video.file_id, filenameHint: "video.mp4", mimeType: msg.video.mime_type ?? "video/mp4" };
      }
      if (msg.document) {
        return { type: "file", fileId: msg.document.file_id, filenameHint: msg.document.file_name ?? "file", mimeType: msg.document.mime_type ?? "application/octet-stream" };
      }
      if (msg.audio) {
        return { type: "audio", fileId: msg.audio.file_id, filenameHint: msg.audio.file_name ?? "audio", mimeType: msg.audio.mime_type ?? "audio/mpeg" };
      }
      if (msg.voice) {
        return { type: "audio", fileId: msg.voice.file_id, filenameHint: "voice.ogg", mimeType: msg.voice.mime_type ?? "audio/ogg" };
      }
      if (msg.sticker) {
        return { type: "image", fileId: msg.sticker.file_id, filenameHint: "sticker.webp", mimeType: "image/webp" };
      }
      return null;
    })();

    if (!selected) return null;

    const file = await this.bot.api.getFile(selected.fileId);
    const filePath = (file as any)?.file_path as string | undefined;
    const fileSize = (file as any)?.file_size as number | undefined;
    if (!filePath) return null;
    if (typeof fileSize === "number" && fileSize > maxBytes) return null;

    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) return null;

    const len = res.headers.get("content-length");
    if (len) {
      const parsed = parseInt(len, 10);
      if (Number.isFinite(parsed) && parsed > maxBytes) return null;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return null;

    const safeName = safeFilename(selected.filenameHint ?? path.basename(filePath) ?? `tg-${selected.fileId}`);
    const outPath = path.join(dir, `${Date.now()}-${safeName}`);
    await fs.writeFile(outPath, buf);

    return {
      type: selected.type,
      data: outPath,
      mimeType: selected.mimeType,
      filename: safeName,
    };
  }
}

function joinUrl(base: string, pathPart: string): string {
  const baseTrimmed = base.replace(/\/$/, "");
  const pathTrimmed = pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  return `${baseTrimmed}${pathTrimmed}`;
}

function splitTelegramText(text: string, limit: number): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const parts: string[] = [];
  let remaining = trimmed;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit * 0.5)) {
      cut = limit;
    }
    const head = remaining.slice(0, cut).trimEnd();
    if (head) parts.push(head);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function safeFilename(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "file";
  const base = path.basename(trimmed);
  return base.replace(/[\\/:*?\"<>|\\u0000-\\u001F]/g, "_");
}

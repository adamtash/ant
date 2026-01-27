import fs from "node:fs/promises";
import path from "node:path";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  type AnyMessageContent,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { areJidsSameUser } from "@whiskeysockets/baileys/lib/WABinary/jid-utils.js";
import qrcode from "qrcode-terminal";
import type { Logger } from "pino";

import type { AntConfig } from "../config.js";
import type { InboundMessage } from "../runtime/context.js";

export type WhatsAppClient = {
  sendText: (jid: string, text: string) => Promise<void>;
  sendTyping: (jid: string, active: boolean) => Promise<void>;
  sendMedia: (
    jid: string,
    payload: { filePath: string; type?: "image" | "video" | "document"; caption?: string },
  ) => Promise<void>;
  close: () => Promise<void>;
};

export async function startWhatsApp(params: {
  cfg: AntConfig;
  logger: Logger;
  onMessage: (message: InboundMessage) => Promise<void>;
}): Promise<WhatsAppClient> {
  await fs.mkdir(params.cfg.resolved.whatsappSessionDir, { recursive: true });

  const sentMessageIds = new Map<string, number>();

  let sock: ReturnType<typeof makeWASocket> | null = null;
  let reconnecting = false;

  const createSocket = async (resetCreds: boolean) => {
    if (resetCreds) {
      await resetAuthState(params.cfg.resolved.whatsappSessionDir);
    }
    const { state, saveCreds } = await useMultiFileAuthState(
      params.cfg.resolved.whatsappSessionDir,
    );
    let selfJid = state.creds.me?.id;
    let selfLid = (state.creds.me as { lid?: string } | undefined)?.lid;
    const refreshSelf = () => {
      selfJid = state.creds.me?.id ?? selfJid;
      selfLid = (state.creds.me as { lid?: string } | undefined)?.lid ?? selfLid;
    };
    const { version } = await fetchLatestBaileysVersion();
    const next = makeWASocket({
      auth: state,
      version,
      logger: params.logger.child({ scope: "baileys" }),
    });

    next.ev.on("creds.update", () => {
      saveCreds();
      refreshSelf();
    });

    next.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        qrcode.generate(qr, { small: true });
        params.logger.info("scan the QR code to pair WhatsApp");
      }
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode as
          | number
          | undefined;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        params.logger.warn(
          { loggedOut, statusCode },
          "whatsapp connection closed",
        );
        if (!reconnecting) {
          reconnecting = true;
          const shouldReset = loggedOut && params.cfg.whatsapp.resetOnLogout;
          const delayMs = 3_000;
          setTimeout(() => {
            reconnecting = false;
            void createSocket(shouldReset);
          }, delayMs);
        }
      }
      if (connection === "open") {
        params.logger.info("whatsapp connection open");
        if (params.cfg.whatsapp.typingIndicator) {
          void next.sendPresenceUpdate("available").catch(() => {});
        }
      }
    });

    next.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        const inbound = toInboundMessage(
          msg,
          { selfJid: selfJid ?? next.user?.id, selfLid },
          params.cfg,
          sentMessageIds,
        );
        if (!inbound) continue;
        await params.onMessage(inbound);
      }
    });

    sock = next;
  };

  await createSocket(false);

  return {
    sendText: async (jid: string, text: string) => {
      if (!sock) return;
      const sent = await sock.sendMessage(jid, { text });
      const id = sent?.key?.id;
      if (id) {
        sentMessageIds.set(id, Date.now());
        pruneSentMessageIds(sentMessageIds);
      }
    },
    sendTyping: async (jid: string, active: boolean) => {
      if (!sock) return;
      if (!params.cfg.whatsapp.typingIndicator) return;
      try {
        await sock.sendPresenceUpdate(active ? "composing" : "paused", jid);
      } catch {
        // ignore presence failures
      }
    },
    sendMedia: async (jid: string, payload) => {
      if (!sock) return;
      const { filePath, caption } = payload;
      const type = payload.type ?? inferMediaType(filePath);
      const fileName = path.basename(filePath);
      const buffer = await fs.readFile(filePath);
      const mimetype = inferMimeType(filePath, type);
      const message: AnyMessageContent =
        type === "video"
          ? { video: buffer, caption, mimetype }
          : type === "document"
            ? {
                document: buffer,
                caption,
                fileName,
                mimetype: mimetype ?? "application/octet-stream",
              }
            : { image: buffer, caption, mimetype };
      try {
        await sock.sendMessage(jid, message);
      } catch (err) {
        params.logger.warn({ error: String(err), filePath, type }, "whatsapp media send failed");
        throw err;
      }
    },
    close: async () => {
      if (!sock) return;
      await sock.logout();
    },
  };
}

function toInboundMessage(
  msg: WAMessage,
  self: { selfJid?: string; selfLid?: string },
  cfg: AntConfig,
  sentMessageIds: Map<string, number>,
): InboundMessage | null {
  if (!msg.message) return null;
  const fromMe = Boolean(msg.key.fromMe);
  if (cfg.whatsapp.respondToSelfOnly) {
    const chatId = msg.key.remoteJid ?? undefined;
    const isSelf =
      (self.selfJid && areJidsSameUser(chatId, self.selfJid)) ||
      (self.selfLid && areJidsSameUser(chatId, self.selfLid));
    if (!isSelf) return null;
  }
  if (fromMe) {
    if (!cfg.whatsapp.allowSelfMessages && !cfg.whatsapp.respondToSelfOnly) return null;
    const id = msg.key.id;
    if (id && sentMessageIds.has(id)) return null;
  }

  const chatId = msg.key.remoteJid;
  if (!chatId) return null;

  const isGroup = chatId.endsWith("@g.us");
  if (isGroup && !cfg.whatsapp.respondToGroups) return null;

  const text = extractText(msg);
  if (!text) return null;

  if (isGroup && cfg.whatsapp.mentionOnly) {
    const mentioned = getMentions(msg);
    const botMentioned = self.selfJid ? mentioned.includes(self.selfJid) : false;
    const nameMentioned = cfg.whatsapp.botName
      ? text.toLowerCase().includes(cfg.whatsapp.botName.toLowerCase())
      : false;
    const keywordMentioned = hasKeywordMention(text, cfg.whatsapp.mentionKeywords);
    if (!botMentioned && !nameMentioned && !keywordMentioned) return null;
  }

  const senderId = msg.key.participant ?? msg.key.remoteJid ?? undefined;
  const senderName = msg.pushName ?? undefined;
  const sessionKey = `whatsapp:${isGroup ? "group" : "dm"}:${chatId}`;

  if (!isAllowedOwner(senderId, chatId, cfg.whatsapp.ownerJids)) {
    return null;
  }

  return {
    sessionKey,
    chatId,
    senderId,
    senderName,
    text,
    isGroup,
    timestamp: Number(msg.messageTimestamp ?? Date.now()),
  };
}

function pruneSentMessageIds(sentMessageIds: Map<string, number>) {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [id, ts] of sentMessageIds.entries()) {
    if (ts < cutoff) sentMessageIds.delete(id);
  }
}

async function resetAuthState(sessionDir: string) {
  try {
    const entries = await fs.readdir(sessionDir);
    await Promise.all(
      entries.map(async (entry) => {
        const filePath = path.join(sessionDir, entry);
        await fs.rm(filePath, { recursive: true, force: true });
      }),
    );
  } catch {
    // ignore
  }
}

function extractText(msg: WAMessage): string | null {
  const message = msg.message;
  if (!message) return null;
  if (message.conversation) return message.conversation.trim();
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text.trim();
  if (message.imageMessage?.caption) return message.imageMessage.caption.trim();
  if (message.videoMessage?.caption) return message.videoMessage.caption.trim();
  return null;
}

function getMentions(msg: WAMessage): string[] {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const mention = ctx?.mentionedJid ?? [];
  return mention;
}

function hasKeywordMention(text: string, keywords: string[]): boolean {
  if (!keywords || keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => keyword && lower.includes(keyword.toLowerCase()));
}

function inferMediaType(filePath: string): "image" | "video" | "document" {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) return "image";
  if ([".mp4", ".mov", ".webm", ".mkv", ".avi"].includes(ext)) return "video";
  return "document";
}

function inferMimeType(filePath: string, kind: "image" | "video" | "document"): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (kind === "image") {
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".gif") return "image/gif";
    if (ext === ".webp") return "image/webp";
    return "image/png";
  }
  if (kind === "video") {
    if (ext === ".mp4") return "video/mp4";
    if (ext === ".mov") return "video/quicktime";
    if (ext === ".webm") return "video/webm";
    if (ext === ".mkv") return "video/x-matroska";
    if (ext === ".avi") return "video/x-msvideo";
    return "video/mp4";
  }
  return undefined;
}

function normalizeJid(value: string | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase();
}

function isAllowedOwner(
  senderId: string | undefined,
  chatId: string | undefined,
  ownerJids: string[],
): boolean {
  if (!ownerJids || ownerJids.length === 0) return true;
  const normalized = new Set(ownerJids.map(normalizeJid));
  const sender = normalizeJid(senderId);
  const chat = normalizeJid(chatId);
  return Boolean(sender && normalized.has(sender)) || Boolean(chat && normalized.has(chat));
}

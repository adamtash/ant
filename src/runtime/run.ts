import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import { createLogger } from "../log.js";
import { MemoryManager } from "../memory/index.js";
import { startWhatsApp } from "../whatsapp/client.js";
import { AgentRunner } from "./agent.js";
import { CommandQueue } from "./queue.js";
import { ensureRuntimePaths } from "./paths.js";
import { SessionStore } from "./session-store.js";
import { SubagentManager } from "./subagents.js";
import { ProviderClients } from "./providers.js";
import { startMemorySync } from "./memory-sync.js";
import { normalizeMediaSource, splitMediaFromOutput } from "./media.js";
import { RuntimeStatusStore } from "./status-store.js";
import { startTui } from "./tui.js";

export async function runAnt(cfg: AntConfig, opts?: { tui?: boolean }): Promise<void> {
  const logger = createLogger(
    cfg.logging.level,
    cfg.resolved.logFilePath,
    cfg.resolved.logFileLevel,
    { console: !opts?.tui },
  );
  const paths = await ensureRuntimePaths(cfg);
  const queue = new CommandQueue(logger, cfg.queue.warnAfterMs);
  const sessions = new SessionStore(paths.sessionsDir);
  const status = new RuntimeStatusStore();
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const memory = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });

  let whatsappClient: Awaited<ReturnType<typeof startWhatsApp>> | null = null;
  const memorySync = startMemorySync({
    cfg,
    memory,
    logger,
    sessionsDir: paths.sessionsDir,
  });

  const sendMessage = async (chatId: string, text: string) => {
    if (!whatsappClient) {
      logger.warn("whatsapp client not ready; dropping message");
      return;
    }
    await whatsappClient.sendText(chatId, text);
  };

  const sendMedia = async (
    chatId: string,
    payload: { filePath: string; type?: "image" | "video" | "document"; caption?: string },
  ) => {
    if (!whatsappClient) {
      logger.warn("whatsapp client not ready; dropping media");
      return;
    }
    logger.debug({ chatId, filePath: payload.filePath, type: payload.type }, "sending media");
    await whatsappClient.sendMedia(chatId, payload);
  };

  const deliverReply = async (chatId: string, reply: string) => {
    const parsed = splitMediaFromOutput(reply);
    const text = parsed.text?.trim() ?? "";
    const mediaUrls = parsed.mediaUrls ?? [];
    if (mediaUrls.length === 0) {
      if (text) {
        await sendMessage(chatId, text);
      }
      return;
    }

    const caption = text || undefined;
    for (let index = 0; index < mediaUrls.length; index += 1) {
      const source = mediaUrls[index] ?? "";
      if (!source) continue;
      try {
        const resolved = await resolveMediaSource(source, cfg);
        await sendMedia(chatId, {
          filePath: resolved,
          caption: index === 0 ? caption : undefined,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ error: message, source }, "media send failed");
        const warning = `⚠️ Media failed: ${message}`;
        const fallbackText = [index === 0 ? caption : "", warning].filter(Boolean).join("\n");
        if (fallbackText) {
          await sendMessage(chatId, fallbackText);
        }
        return;
      }
    }
  };

  let agent: AgentRunner | null = null;
  const subagents = new SubagentManager({
    cfg,
    logger,
    filePath: paths.subagentsFile,
    sendMessage,
    runTask: async (params) => {
      if (!agent) throw new Error("agent not ready");
      return agent.runTask(params);
    },
  });
  await subagents.load();

  const tui = opts?.tui ? startTui({ queue, subagents, status }) : null;

  agent = new AgentRunner({
    cfg,
    logger,
    providers,
    memory,
    sessions,
    subagents,
    sendMessage,
    sendMedia,
  });

  whatsappClient = await startWhatsApp({
    cfg,
    logger,
    onMessage: async (message) => {
      await queue.enqueue(message.sessionKey, async () => {
        logger.info({ sessionKey: message.sessionKey }, "inbound message");
        await whatsappClient?.sendTyping(message.chatId, true);
        status.startMainTask({
          sessionKey: message.sessionKey,
          chatId: message.chatId,
          text: message.text,
        });
        try {
          const reply = await agent!.runInboundMessage(message);
          await deliverReply(message.chatId, reply);
          status.finishMainTask(message.sessionKey, { status: "complete" });
        } catch (err) {
          status.finishMainTask(message.sessionKey, {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          await whatsappClient?.sendTyping(message.chatId, false);
        }
      });
    },
  });

  logger.info("ant runtime started");
}

const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

async function resolveMediaSource(source: string, cfg: AntConfig): Promise<string> {
  const normalized = normalizeMediaSource(source.trim());
  if (!normalized) {
    throw new Error("empty media source");
  }
  if (/^https?:\/\//i.test(normalized)) {
    return await downloadMedia(normalized, cfg);
  }
  if (normalized.startsWith("~")) {
    return path.join(process.env.HOME ?? "", normalized.slice(1));
  }
  if (path.isAbsolute(normalized)) {
    return normalized;
  }
  return path.resolve(cfg.resolved.workspaceDir, normalized);
}

async function downloadMedia(url: string, cfg: AntConfig): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed (${res.status})`);
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`media exceeds ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))}MB limit`);
  }
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  const ext = guessExtFromContentType(contentType) || guessExtFromUrl(url);
  const dir = path.join(cfg.resolved.stateDir, "outbound");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `media-${Date.now()}${ext}`);
  await fs.writeFile(filePath, Buffer.from(arrayBuffer));
  return filePath;
}

function guessExtFromContentType(contentType: string): string {
  if (!contentType) return "";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/jpeg") return ".jpg";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "video/mp4") return ".mp4";
  if (contentType === "video/quicktime") return ".mov";
  if (contentType === "application/pdf") return ".pdf";
  return "";
}

function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname);
    return ext || "";
  } catch {
    return "";
  }
}

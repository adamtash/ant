/**
 * Session Manager - Manages sessions across all channels
 */

import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import type { Channel, ToolPart } from "../agent/types.js";
import type { Logger } from "../log.js";
import { FileStorageBackend, type StorageBackend } from "./storage.js";

/**
 * Session context
 */
export interface SessionContext {
  sessionKey: string;
  channel: Channel;
  chatId?: string;
  createdAt: number;
  lastActivityAt: number;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Session message
 */
export interface SessionMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  timestamp: number;
  channel?: Channel;
  chatId?: string;
  toolCallId?: string;
  name?: string;
  providerId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Session Manager - Handles session lifecycle and persistence
 */
export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private appendQueue: Map<string, Promise<void>> = new Map();
  private readonly stateDir: string;
  private readonly logger: Logger;
  private readonly storage: StorageBackend;

  constructor(params: { stateDir: string; logger: Logger; storage?: StorageBackend }) {
    this.stateDir = params.stateDir;
    this.logger = params.logger.child({ component: "session-manager" });
    this.storage = params.storage ?? new FileStorageBackend(this.stateDir);
    
    // Pre-create sessions directory to avoid race conditions
    try {
      const sessionsDir = path.join(this.stateDir, "sessions");
      nodeFs.mkdirSync(sessionsDir, { recursive: true });
    } catch (err) {
      this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Failed to pre-create sessions directory");
    }
  }

  /**
   * Initialize and load all sessions from disk
   */
  async initialize(): Promise<void> {
    const sessionsDir = path.join(this.stateDir, "sessions");
    
    try {
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));
      
      for (const file of sessionFiles) {
        try {
          // Read the first line to get the actual sessionKey
          const filePath = path.join(sessionsDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const firstLine = content.trim().split("\n")[0];
          
          if (!firstLine) continue;
          
          const firstMessage = JSON.parse(firstLine);
          const actualSessionKey = firstMessage.sessionKey;
          
          if (actualSessionKey) {
            const session = await this.loadSession(actualSessionKey);
            if (session) {
              this.sessions.set(session.sessionKey, session);
            }
          }
        } catch (err) {
          this.logger.debug(
            { file, error: err instanceof Error ? err.message : String(err) },
            "Failed to load session from file"
          );
        }
      }
      
      this.logger.info({ count: this.sessions.size }, "Sessions loaded from disk");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        this.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Failed to load sessions from disk"
        );
      }
    }
  }

  /**
   * Get or create a session
   */
  async getOrCreate(params: {
    sessionKey: string;
    channel: Channel;
    chatId?: string;
  }): Promise<SessionContext> {
    let session = this.sessions.get(params.sessionKey);

    if (!session) {
      // Try to load from disk
      session = await this.loadSession(params.sessionKey);
    }

    if (!session) {
      // Create new session
      session = {
        sessionKey: params.sessionKey,
        channel: params.channel,
        chatId: params.chatId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 0,
      };

      this.logger.debug({ sessionKey: params.sessionKey }, "New session created");
    }

    // Update channel info if provided
    if (params.channel) session.channel = params.channel;
    if (params.chatId) session.chatId = params.chatId;
    session.lastActivityAt = Date.now();

    this.sessions.set(params.sessionKey, session);
    return session;
  }

  /**
   * Update session context
   */
  update(sessionKey: string, updates: Partial<SessionContext>): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      Object.assign(session, updates, { lastActivityAt: Date.now() });
    }
  }

  /**
   * Get session by key
   */
  get(sessionKey: string): SessionContext | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * List all sessions
   */
  list(): SessionContext[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Append a message to session history
   */
  async appendMessage(sessionKey: string, message: SessionMessage): Promise<void> {
    const previous = this.appendQueue.get(sessionKey) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        // Ensure a previous write failure doesn't block subsequent appends.
      })
      .then(async () => {
        const session = this.sessions.get(sessionKey);
        if (session) {
          session.messageCount++;
          session.lastActivityAt = Date.now();
        }

        const safeKey = this.getSafeSessionKey(sessionKey);

        try {
          await this.storage.appendJsonLine(["sessions", safeKey], {
            ...message,
            sessionKey,
          });
        } catch (err) {
          this.logger.error(
            { error: err instanceof Error ? err.message : String(err), sessionKey },
            "Failed to append message to session"
          );
          throw err;
        }
      });

    this.appendQueue.set(sessionKey, next);

    try {
      await next;
    } finally {
      if (this.appendQueue.get(sessionKey) === next) {
        this.appendQueue.delete(sessionKey);
      }
    }
  }

  /**
   * Read session messages
   */
  async readMessages(sessionKey: string, limit?: number): Promise<SessionMessage[]> {
    try {
      const safeKey = this.getSafeSessionKey(sessionKey);
      const lines = await this.storage.readJsonLines<Record<string, unknown>>(["sessions", safeKey]);

      const messages: SessionMessage[] = lines.map((parsed) => ({
        role: (parsed.role as SessionMessage["role"]) ?? "user",
        content: String(parsed.content ?? ""),
        timestamp: (parsed.timestamp as number) || (parsed.ts as number) || Date.now(),
        channel: (parsed.channel as Channel | undefined) ?? undefined,
        chatId: (parsed.chatId as string | undefined) ?? undefined,
        toolCallId: parsed.toolCallId as string | undefined,
        name: parsed.name as string | undefined,
        providerId: parsed.providerId as string | undefined,
        model: parsed.model as string | undefined,
        metadata: parsed.metadata as Record<string, unknown> | undefined,
      }));

      if (limit && messages.length > limit) {
        return messages.slice(-limit);
      }

      return messages;
    } catch {
      return [];
    }
  }

  /**
   * Clear session history
   */
  async clear(sessionKey: string): Promise<void> {
    this.sessions.delete(sessionKey);

    const sessionFile = this.getSessionFilePath(sessionKey);
    try {
      await fs.unlink(sessionFile);
    } catch {
      // File doesn't exist
    }

    try {
      const safeKey = this.getSafeSessionKey(sessionKey);
      const keys = await this.storage.listKeys(["tool-parts", safeKey]);
      for (const key of keys) {
        await this.storage.remove(key);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Upsert a tool part for a session
   */
  async upsertToolPart(sessionKey: string, part: ToolPart): Promise<void> {
    const safeKey = this.getSafeSessionKey(sessionKey);
    try {
      await this.storage.writeJson(["tool-parts", safeKey, part.id], part);
    } catch (err) {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err), sessionKey, tool: part.tool },
        "Failed to persist tool part"
      );
    }
  }

  /**
   * List tool parts for a session
   */
  async listToolParts(sessionKey: string): Promise<ToolPart[]> {
    const safeKey = this.getSafeSessionKey(sessionKey);
    try {
      const keys = await this.storage.listKeys(["tool-parts", safeKey]);
      const parts: ToolPart[] = [];
      for (const key of keys) {
        const part = await this.storage.readJson<ToolPart>(key);
        if (part) parts.push(part);
      }
      return parts;
    } catch {
      return [];
    }
  }

  /**
   * Load session from disk
   */
  private async loadSession(sessionKey: string): Promise<SessionContext | undefined> {
    const sessionFile = this.getSessionFilePath(sessionKey);

    try {
      const stats = await fs.stat(sessionFile);
      const content = await fs.readFile(sessionFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      if (lines.length === 0) return undefined;

      // Parse first and last message to get metadata
      const firstMessage = JSON.parse(lines[0]);
      const lastMessage = JSON.parse(lines[lines.length - 1]);

      return {
        sessionKey,
        channel: firstMessage.channel || "cli",
        chatId: firstMessage.chatId,
        createdAt: stats.birthtime.getTime(),
        lastActivityAt: lastMessage.timestamp || Date.now(),
        messageCount: lines.length,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(sessionKey: string): string {
    const safeKey = this.getSafeSessionKey(sessionKey);
    return path.join(this.stateDir, "sessions", `${safeKey}.jsonl`);
  }

  private getSafeSessionKey(sessionKey: string): string {
    return sessionKey
      .split(":")
      .map(part => part.replace(/[^a-zA-Z0-9_-]/g, "_"))
      .join("_");
  }

  /**
   * Get active session count
   */
  get activeCount(): number {
    return this.sessions.size;
  }

  /**
   * Clean up old sessions
   */
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityAt > maxAgeMs) {
        this.sessions.delete(key);
        cleaned++;
      }
    }

    this.logger.info({ cleaned }, "Session cleanup complete");
    return cleaned;
  }
}

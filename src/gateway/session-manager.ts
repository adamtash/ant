/**
 * Session Manager - Manages sessions across all channels
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Channel } from "../agent/types.js";
import type { Logger } from "../log.js";

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
  toolCallId?: string;
  name?: string;
}

/**
 * Session Manager - Handles session lifecycle and persistence
 */
export class SessionManager {
  private sessions: Map<string, SessionContext> = new Map();
  private readonly stateDir: string;
  private readonly logger: Logger;

  constructor(params: { stateDir: string; logger: Logger }) {
    this.stateDir = params.stateDir;
    this.logger = params.logger.child({ component: "session-manager" });
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
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.messageCount++;
      session.lastActivityAt = Date.now();
    }

    // Append to session file
    const sessionFile = this.getSessionFilePath(sessionKey);
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });

    const line = JSON.stringify({
      ...message,
      sessionKey,
    }) + "\n";

    await fs.appendFile(sessionFile, line, "utf-8");
  }

  /**
   * Read session messages
   */
  async readMessages(sessionKey: string, limit?: number): Promise<SessionMessage[]> {
    const sessionFile = this.getSessionFilePath(sessionKey);

    try {
      const content = await fs.readFile(sessionFile, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      const messages: SessionMessage[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          messages.push({
            role: parsed.role,
            content: parsed.content,
            timestamp: parsed.timestamp || parsed.ts,
            toolCallId: parsed.toolCallId,
            name: parsed.name,
          });
        } catch {
          // Skip invalid lines
        }
      }

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
    const safeKey = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.stateDir, "sessions", `${safeKey}.jsonl`);
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

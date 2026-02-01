/**
 * CLI Session Manager
 *
 * Manages terminal sessions for the CLI adapter, including:
 * - Session creation and tracking
 * - Input history
 * - Session persistence (optional)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ChannelSession } from "../types.js";
import type { Logger } from "../../log.js";

// ============================================================================
// Configuration
// ============================================================================

export interface CLISessionManagerConfig {
  /** Logger instance */
  logger: Logger;

  /** Directory for session persistence */
  persistDir?: string;

  /** Session timeout in ms (default: 1 hour) */
  sessionTimeoutMs?: number;

  /** Maximum history entries per session */
  maxHistoryEntries?: number;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * CLI-specific session data
 */
export interface CLISession extends ChannelSession {
  /** Input history for this session */
  inputHistory: string[];

  /** Current working directory */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Whether the session is interactive */
  interactive: boolean;
}

/**
 * Persisted session format
 */
interface PersistedSession {
  sessionKey: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  inputHistory: string[];
  cwd?: string;
  user?: { id: string; name: string };
}

// ============================================================================
// Session Manager
// ============================================================================

export class CLISessionManager {
  private readonly logger: Logger;
  private readonly persistDir?: string;
  private readonly sessionTimeoutMs: number;
  private readonly maxHistoryEntries: number;
  private readonly sessions: Map<string, CLISession> = new Map();

  constructor(config: CLISessionManagerConfig) {
    this.logger = config.logger.child({ component: "cli-session-manager" });
    this.persistDir = config.persistDir;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 60 * 60 * 1000; // 1 hour
    this.maxHistoryEntries = config.maxHistoryEntries ?? 1000;
  }

  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionKey?: string, user?: { id: string; name: string }): CLISession {
    const key = sessionKey ?? this.generateSessionKey();
    const existing = this.sessions.get(key);

    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    const now = Date.now();
    const session: CLISession = {
      sessionKey: key,
      channel: "cli",
      createdAt: now,
      lastActivity: now,
      messageCount: 0,
      inputHistory: [],
      interactive: true,
      user,
    };

    this.sessions.set(key, session);
    this.logger.debug({ sessionKey: key }, "Created new CLI session");

    return session;
  }

  /**
   * Get an existing session
   */
  getSession(sessionKey: string): CLISession | undefined {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * End a session
   */
  endSession(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      this.sessions.delete(sessionKey);
      this.logger.debug({ sessionKey }, "Ended CLI session");
    }
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): CLISession[] {
    return Array.from(this.sessions.values());
  }

  // ==========================================================================
  // History Management
  // ==========================================================================

  /**
   * Add an input to the session history
   */
  addToHistory(sessionKey: string, input: string): void {
    const session = this.sessions.get(sessionKey);
    if (!session) return;

    session.inputHistory.push(input);
    session.messageCount += 1;

    // Trim history if needed
    if (session.inputHistory.length > this.maxHistoryEntries) {
      session.inputHistory = session.inputHistory.slice(-this.maxHistoryEntries);
    }
  }

  /**
   * Get the input history for a session
   */
  getHistory(sessionKey: string): string[] {
    const session = this.sessions.get(sessionKey);
    return session?.inputHistory ?? [];
  }

  /**
   * Clear the history for a session
   */
  clearHistory(sessionKey: string): void {
    const session = this.sessions.get(sessionKey);
    if (session) {
      session.inputHistory = [];
    }
  }

  // ==========================================================================
  // Session Persistence
  // ==========================================================================

  /**
   * Load sessions from disk
   */
  async loadSessions(): Promise<void> {
    if (!this.persistDir) return;

    try {
      const files = await fs.readdir(this.persistDir);
      const sessionFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of sessionFiles) {
        try {
          const filePath = path.join(this.persistDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const persisted = JSON.parse(content) as PersistedSession;

          // Skip expired sessions
          if (Date.now() - persisted.lastActivity > this.sessionTimeoutMs) {
            await fs.unlink(filePath).catch(() => {});
            continue;
          }

          const session: CLISession = {
            sessionKey: persisted.sessionKey,
            channel: "cli",
            createdAt: persisted.createdAt,
            lastActivity: persisted.lastActivity,
            messageCount: persisted.messageCount,
            inputHistory: persisted.inputHistory,
            cwd: persisted.cwd,
            interactive: true,
            user: persisted.user,
          };

          this.sessions.set(persisted.sessionKey, session);
        } catch (err) {
          this.logger.warn({ file, error: String(err) }, "Failed to load session");
        }
      }

      this.logger.debug({ count: this.sessions.size }, "Loaded persisted sessions");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.logger.warn({ error: String(err) }, "Failed to load sessions");
      }
    }
  }

  /**
   * Save a session to disk
   */
  async saveSession(sessionKey: string): Promise<void> {
    if (!this.persistDir) return;

    const session = this.sessions.get(sessionKey);
    if (!session) return;

    try {
      await fs.mkdir(this.persistDir, { recursive: true });

      const persisted: PersistedSession = {
        sessionKey: session.sessionKey,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        messageCount: session.messageCount,
        inputHistory: session.inputHistory,
        cwd: session.cwd,
        user: session.user,
      };

      const filePath = path.join(this.persistDir, `${encodeURIComponent(sessionKey)}.json`);
      await fs.writeFile(filePath, JSON.stringify(persisted, null, 2));
    } catch (err) {
      this.logger.warn({ sessionKey, error: String(err) }, "Failed to save session");
    }
  }

  /**
   * Save all sessions to disk
   */
  async saveAllSessions(): Promise<void> {
    for (const sessionKey of this.sessions.keys()) {
      await this.saveSession(sessionKey);
    }
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  /**
   * Remove expired sessions
   */
  pruneExpiredSessions(): number {
    const now = Date.now();
    const cutoff = now - this.sessionTimeoutMs;
    let pruned = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(key);
        pruned += 1;
      }
    }

    if (pruned > 0) {
      this.logger.debug({ pruned }, "Pruned expired CLI sessions");
    }

    return pruned;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private generateSessionKey(): string {
    return `cli:${randomUUID().slice(0, 8)}`;
  }
}

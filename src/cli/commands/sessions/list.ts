/**
 * Sessions List Command - List all sessions
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { ensureRuntimePaths } from "../../../gateway/process-control.js";
import { SessionManager, type SessionMessage } from "../../../gateway/session-manager.js";
import { createLogger } from "../../../log.js";

export interface SessionsListOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

interface SessionInfo {
  key: string;
  messageCount: number;
  lastActivity: number;
  size: number;
}

/**
 * List session keys from the sessions directory
 */
async function listSessionKeys(sessionDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(sessionDir);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(/\.jsonl$/, ""));
  } catch {
    return [];
  }
}

/**
 * List all sessions
 */
export async function sessionsList(cfg: AntConfig, options: SessionsListOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });
  const paths = await ensureRuntimePaths(cfg);
  const logger = createLogger("silent");
  const sessionManager = new SessionManager({ stateDir: paths.stateDir, logger });

  const sessions = await listSessionKeys(paths.sessionDir);

  if (options.json) {
    const detailed = await Promise.all(
      sessions.map(async (key) => {
        const messages = await sessionManager.readMessages(key);
        const lastMsg = messages[messages.length - 1] as SessionMessage | undefined;
        return {
          key,
          messageCount: messages.length,
          lastActivity: lastMsg ? lastMsg.timestamp : 0,
        };
      })
    );
    out.json(detailed);
    return;
  }

  if (sessions.length === 0) {
    out.info("No sessions found.");
    return;
  }

  out.header("Sessions");

  // Get details for each session
  const sessionDetails: SessionInfo[] = [];
  for (const key of sessions) {
    try {
      const messages = await sessionManager.readMessages(key);
      const lastMsg = messages[messages.length - 1] as SessionMessage | undefined;
      sessionDetails.push({
        key,
        messageCount: messages.length,
        lastActivity: lastMsg ? lastMsg.timestamp : 0,
        size: JSON.stringify(messages).length,
      });
    } catch {
      sessionDetails.push({
        key,
        messageCount: 0,
        lastActivity: 0,
        size: 0,
      });
    }
  }

  // Sort by last activity
  sessionDetails.sort((a, b) => b.lastActivity - a.lastActivity);

  out.table(
    sessionDetails.map((s) => ({
      key: s.key.length > 30 ? s.key.slice(0, 27) + "..." : s.key,
      messages: s.messageCount,
      lastActivity: s.lastActivity > 0 ? out.formatTime(s.lastActivity) : "never",
      size: out.formatBytes(s.size),
    })),
    [
      { key: "key", header: "Session Key", width: 32 },
      { key: "messages", header: "Messages", width: 10, align: "right" },
      { key: "lastActivity", header: "Last Activity", width: 22 },
      { key: "size", header: "Size", width: 10, align: "right" },
    ]
  );

  out.newline();
  out.info(`Total: ${sessions.length} session(s)`);
}

export default sessionsList;

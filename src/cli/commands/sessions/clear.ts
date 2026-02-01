/**
 * Sessions Clear Command - Clear a session
 */

import fs from "node:fs/promises";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { ValidationError } from "../../error-handler.js";
import { ensureRuntimePaths } from "../../../gateway/process-control.js";
import { SessionManager } from "../../../gateway/session-manager.js";
import { createLogger } from "../../../log.js";

export interface SessionsClearOptions {
  config?: string;
  all?: boolean;
  force?: boolean;
  json?: boolean;
  quiet?: boolean;
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
 * Clear a session or all sessions
 */
export async function sessionsClear(cfg: AntConfig, sessionKey: string | undefined, options: SessionsClearOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  const paths = await ensureRuntimePaths(cfg);
  const logger = createLogger("silent");
  const sessionManager = new SessionManager({ stateDir: paths.stateDir, logger });

  if (options.all) {
    // Clear all sessions
    const sessions = await listSessionKeys(paths.sessionDir);

    if (sessions.length === 0) {
      out.info("No sessions to clear.");
      return;
    }

    if (!options.force) {
      out.warn(`This will delete ${sessions.length} session(s). Use --force to confirm.`);
      return;
    }

    let cleared = 0;
    for (const key of sessions) {
      try {
        await sessionManager.clear(key);
        cleared++;
      } catch {
        // Ignore individual errors
      }
    }

    if (options.json) {
      out.json({ success: true, cleared, total: sessions.length });
      return;
    }

    out.success(`Cleared ${cleared}/${sessions.length} session(s).`);
    return;
  }

  if (!sessionKey?.trim()) {
    throw new ValidationError(
      "Session key is required",
      "Use 'ant sessions list' to see available sessions, or use --all to clear all."
    );
  }

  // Clear specific session
  const messages = await sessionManager.readMessages(sessionKey.trim());

  if (messages.length === 0) {
    out.info(`Session "${sessionKey}" has no messages or does not exist.`);
    return;
  }

  if (!options.force) {
    out.warn(`This will delete session "${sessionKey}" with ${messages.length} message(s). Use --force to confirm.`);
    return;
  }

  await sessionManager.clear(sessionKey.trim());

  if (options.json) {
    out.json({ success: true, sessionKey, messagesDeleted: messages.length });
    return;
  }

  out.success(`Cleared session "${sessionKey}" (${messages.length} messages).`);
}

export default sessionsClear;

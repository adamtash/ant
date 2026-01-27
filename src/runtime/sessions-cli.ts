import type { AntConfig } from "../config.js";
import { ensureRuntimePaths } from "./paths.js";
import { SessionStore } from "./session-store.js";

export async function listSessions(cfg: AntConfig): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  const store = new SessionStore(paths.sessionsDir);
  const sessions = await store.listSessions();
  if (sessions.length === 0) {
    console.log("No sessions.");
    return;
  }
  for (const session of sessions) {
    console.log(session);
  }
}

export async function showSession(cfg: AntConfig, sessionKey: string): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  const store = new SessionStore(paths.sessionsDir);
  const messages = await store.readMessages(sessionKey);
  if (messages.length === 0) {
    console.log("No messages.");
    return;
  }
  for (const msg of messages) {
    console.log(`[${new Date(msg.ts).toISOString()}] ${msg.role}: ${msg.content}`);
  }
}

export async function clearSession(cfg: AntConfig, sessionKey: string): Promise<void> {
  const paths = await ensureRuntimePaths(cfg);
  const store = new SessionStore(paths.sessionsDir);
  await store.clearSession(sessionKey);
  console.log(`Cleared session ${sessionKey}`);
}

import fs from "node:fs/promises";
import path from "node:path";

export type SessionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  ts: number;
  toolCallId?: string;
  name?: string;
};

export type SessionContext = {
  sessionKey: string;
  lastChannel?: string;
  lastChatId?: string;
};

export class SessionStore {
  private readonly dir: string;
  private readonly context = new Map<string, SessionContext>();

  constructor(dir: string) {
    this.dir = dir;
  }

  getSessionFile(sessionKey: string): string {
    return path.join(this.dir, `${encodeURIComponent(sessionKey)}.jsonl`);
  }

  async appendMessage(sessionKey: string, message: SessionMessage): Promise<void> {
    const filePath = this.getSessionFile(sessionKey);
    const line = JSON.stringify(message) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  }

  async readMessages(sessionKey: string, limit?: number): Promise<SessionMessage[]> {
    const filePath = this.getSessionFile(sessionKey);
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      return [];
    }
    const lines = raw.split("\n").filter(Boolean);
    const messages = lines
      .map((line) => {
        try {
          return JSON.parse(line) as SessionMessage;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SessionMessage => Boolean(entry));
    if (!limit || messages.length <= limit) return messages;
    return messages.slice(messages.length - limit);
  }

  async listSessions(): Promise<string[]> {
    const entries = await fs.readdir(this.dir);
    return entries
      .filter((file) => file.endsWith(".jsonl"))
      .map((file) => decodeURIComponent(file.replace(/\.jsonl$/, "")));
  }

  async clearSession(sessionKey: string): Promise<void> {
    const filePath = this.getSessionFile(sessionKey);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }

  setSessionContext(sessionKey: string, context: SessionContext) {
    this.context.set(sessionKey, context);
  }

  getSessionContext(sessionKey: string): SessionContext | undefined {
    return this.context.get(sessionKey);
  }
}

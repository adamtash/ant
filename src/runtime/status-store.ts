export type MainTaskStatus = {
  sessionKey: string;
  chatId: string;
  text: string;
  status: "running" | "complete" | "error";
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export class RuntimeStatusStore {
  private readonly running = new Map<string, MainTaskStatus>();
  private readonly recent: MainTaskStatus[] = [];
  private readonly maxRecent = 25;

  startMainTask(params: { sessionKey: string; chatId: string; text: string }): MainTaskStatus {
    const entry: MainTaskStatus = {
      sessionKey: params.sessionKey,
      chatId: params.chatId,
      text: params.text,
      status: "running",
      startedAt: Date.now(),
    };
    this.running.set(params.sessionKey, entry);
    this.recent.unshift(entry);
    if (this.recent.length > this.maxRecent) {
      this.recent.length = this.maxRecent;
    }
    return entry;
  }

  finishMainTask(sessionKey: string, params: { status: "complete" | "error"; error?: string }) {
    const entry = this.running.get(sessionKey);
    if (!entry) return;
    entry.status = params.status;
    entry.error = params.error;
    entry.endedAt = Date.now();
    this.running.delete(sessionKey);
  }

  listRunning(): MainTaskStatus[] {
    return [...this.running.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  listRecent(): MainTaskStatus[] {
    return this.recent.slice(0, this.maxRecent);
  }
}

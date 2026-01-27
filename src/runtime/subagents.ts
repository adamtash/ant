import crypto from "node:crypto";
import fs from "node:fs/promises";

import type { AntConfig } from "../config.js";
import type { Logger } from "../log.js";

export type SubagentRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterChatId: string;
  task: string;
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  status: "pending" | "running" | "complete" | "error";
  result?: string;
  error?: string;
};

export type SubagentRunResult = {
  runId: string;
  childSessionKey: string;
  status: "queued" | "started";
};

export class SubagentManager {
  private readonly cfg: AntConfig;
  private readonly logger: Logger;
  private readonly filePath: string;
  private readonly sendMessage: (chatId: string, text: string) => Promise<void>;
  private readonly runTask: (params: {
    sessionKey: string;
    task: string;
    isSubagent: boolean;
  }) => Promise<string>;
  private readonly records = new Map<string, SubagentRecord>();

  constructor(params: {
    cfg: AntConfig;
    logger: Logger;
    filePath: string;
    sendMessage: (chatId: string, text: string) => Promise<void>;
    runTask: (params: { sessionKey: string; task: string; isSubagent: boolean }) => Promise<string>;
  }) {
    this.cfg = params.cfg;
    this.logger = params.logger;
    this.filePath = params.filePath;
    this.sendMessage = params.sendMessage;
    this.runTask = params.runTask;
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as SubagentRecord[];
      for (const record of parsed) {
        this.records.set(record.runId, record);
      }
    } catch {
      // ignore
    }
  }

  async list(): Promise<SubagentRecord[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  snapshot(): SubagentRecord[] {
    return [...this.records.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async spawn(params: { task: string; label?: string; requester?: { sessionKey: string; chatId: string } }): Promise<SubagentRunResult> {
    if (!this.cfg.subagents.enabled) {
      return { runId: "disabled", childSessionKey: "", status: "queued" };
    }

    const runId = crypto.randomUUID();
    const childSessionKey = `subagent:${runId}`;
    const requesterSessionKey = params.requester?.sessionKey ?? "unknown";
    const requesterChatId = params.requester?.chatId ?? "";

    const record: SubagentRecord = {
      runId,
      childSessionKey,
      requesterSessionKey,
      requesterChatId,
      task: params.task,
      label: params.label,
      createdAt: Date.now(),
      status: "pending",
    };
    this.records.set(runId, record);
    await this.persist();

    void this.runSubagent(record);

    return { runId, childSessionKey, status: "queued" };
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const cutoff = this.cfg.subagents.archiveAfterMinutes * 60_000;
    let changed = false;
    for (const [runId, record] of this.records.entries()) {
      if (record.endedAt && now - record.endedAt > cutoff) {
        this.records.delete(runId);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async runSubagent(record: SubagentRecord): Promise<void> {
    record.status = "running";
    record.startedAt = Date.now();
    await this.persist();

    try {
      const result = await this.runTask({
        sessionKey: record.childSessionKey,
        task: record.task,
        isSubagent: true,
      });
      record.status = "complete";
      record.result = result;
      record.endedAt = Date.now();
      await this.persist();
      await this.announce(record, result);
    } catch (err) {
      record.status = "error";
      record.error = err instanceof Error ? err.message : String(err);
      record.endedAt = Date.now();
      await this.persist();
      await this.announce(record, `Subagent failed: ${record.error}`);
    }
  }

  private async announce(record: SubagentRecord, text: string) {
    if (!record.requesterChatId) return;
    const label = record.label ? ` (${record.label})` : "";
    const message = `Subagent${label} result:\n${text}`;
    await this.sendMessage(record.requesterChatId, message);
  }

  private async persist() {
    const data = JSON.stringify([...this.records.values()], null, 2);
    await fs.writeFile(this.filePath, data, "utf-8");
  }
}

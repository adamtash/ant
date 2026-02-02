import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { Logger } from "../../log.js";
import { getEventStream, createEventPublishers } from "../../monitor/event-stream.js";
import { canTransition } from "./state-machine.js";
import type {
  NewTaskInput,
  TaskEntry,
  TaskPhase,
  TaskProgress,
  TaskResult,
  TaskState,
} from "./types.js";

interface TaskCacheEntry {
  task: TaskEntry;
  expiresAt: number;
  mtimeMs: number;
}

export class TaskStore {
  private readonly dir: string;
  private readonly logger: Logger;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, TaskCacheEntry>();
  private readonly events = createEventPublishers(getEventStream());

  constructor(params: { stateDir: string; logger: Logger; cacheTtlMs: number; taskDir?: string }) {
    this.dir = params.taskDir ?? path.join(params.stateDir, "tasks");
    this.logger = params.logger.child({ component: "task-store" });
    this.cacheTtlMs = params.cacheTtlMs;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  async create(input: NewTaskInput): Promise<TaskEntry> {
    const now = Date.now();
    const taskId = crypto.randomUUID();
    const retries = {
      attempted: 0,
      maxAttempts: input.retries?.maxAttempts ?? 3,
      nextRetryAt: input.retries?.nextRetryAt,
      backoffMs: input.retries?.backoffMs,
    };
    const timeout = input.timeoutMs
      ? {
          startedAt: now,
          maxDurationMs: input.timeoutMs,
          willExpireAt: now + input.timeoutMs,
        }
      : undefined;

    const task: TaskEntry = {
      taskId,
      parentTaskId: input.parentTaskId,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      description: input.description,
      sessionKey: input.sessionKey,
      lane: input.lane,
      metadata: input.metadata,
      retries,
      timeout,
      history: [{ state: "pending", at: now }],
    };

    await this.write(task);
    await this.events.taskCreated(
      {
        taskId: task.taskId,
        description: task.description,
        createdAt: task.createdAt,
        parentTaskId: task.parentTaskId,
        lane: task.lane,
      },
      { sessionKey: task.sessionKey, channel: task.metadata.channel }
    );

    return task;
  }

  async get(taskId: string): Promise<TaskEntry | undefined> {
    const cached = this.cache.get(taskId);
    if (cached && cached.expiresAt > Date.now()) {
      const stat = await this.safeStat(taskId);
      if (!stat || stat.mtimeMs === cached.mtimeMs) {
        return cached.task;
      }
    }

    const task = await this.read(taskId);
    if (!task) return undefined;

    const stat = await this.safeStat(taskId);
    this.cache.set(taskId, {
      task,
      expiresAt: Date.now() + this.cacheTtlMs,
      mtimeMs: stat?.mtimeMs ?? Date.now(),
    });
    return task;
  }

  async list(): Promise<TaskEntry[]> {
    await fs.mkdir(this.dir, { recursive: true });
    const files = await fs.readdir(this.dir);
    const tasks: TaskEntry[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const taskId = file.replace(/\.json$/i, "");
      const task = await this.get(taskId);
      if (task) tasks.push(task);
    }
    return tasks.sort((a, b) => b.createdAt - a.createdAt);
  }

  async update(taskId: string, updates: Partial<TaskEntry>): Promise<TaskEntry> {
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const next: TaskEntry = {
      ...task,
      ...updates,
      updatedAt: Date.now(),
    };

    await this.write(next);
    return next;
  }

  async updateStatus(taskId: string, nextState: TaskState, reason?: string): Promise<TaskEntry> {
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== nextState && !canTransition(task.status, nextState)) {
      this.logger.warn({ taskId, from: task.status, to: nextState }, "Illegal task state transition");
    }

    const updated: TaskEntry = {
      ...task,
      status: nextState,
      updatedAt: Date.now(),
      history: [...task.history, { state: nextState, at: Date.now(), reason }],
    };

    await this.write(updated);

    await this.events.taskStatusChanged(
      {
        taskId,
        parentTaskId: task.parentTaskId,
        previousState: task.status,
        newState: nextState,
        reason,
        timestamp: Date.now(),
      },
      { sessionKey: task.sessionKey, channel: task.metadata.channel }
    );

    return updated;
  }

  async updatePhase(taskId: string, phase: TaskPhase): Promise<TaskEntry> {
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const updated: TaskEntry = {
      ...task,
      phase,
      updatedAt: Date.now(),
    };

    await this.write(updated);

    await this.events.taskPhaseChanged(
      {
        taskId,
        previousPhase: task.phase ?? null,
        newPhase: phase,
        timestamp: Date.now(),
      },
      { sessionKey: task.sessionKey, channel: task.metadata.channel }
    );

    return updated;
  }

  async updateProgress(taskId: string, progress: TaskProgress): Promise<TaskEntry> {
    const task = await this.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const updated: TaskEntry = {
      ...task,
      progress,
      updatedAt: Date.now(),
    };

    await this.write(updated);

    await this.events.taskProgressUpdated(
      {
        taskId,
        parentTaskId: task.parentTaskId,
        phase: task.phase ?? null,
        progress,
        timestamp: Date.now(),
      },
      { sessionKey: task.sessionKey, channel: task.metadata.channel }
    );

    return updated;
  }

  async setResult(taskId: string, result: TaskResult, error?: string): Promise<TaskEntry> {
    return this.update(taskId, { result, error });
  }

  async getActiveTasks(): Promise<TaskEntry[]> {
    const tasks = await this.list();
    return tasks.filter((task) => ["queued", "running", "retrying"].includes(task.status));
  }

  private async read(taskId: string): Promise<TaskEntry | undefined> {
    const filePath = this.pathFor(taskId);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as TaskEntry;
    } catch {
      return undefined;
    }
  }

  private async write(task: TaskEntry): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.pathFor(task.taskId), JSON.stringify(task, null, 2), "utf-8");
    const stat = await this.safeStat(task.taskId);
    this.cache.set(task.taskId, {
      task,
      expiresAt: Date.now() + this.cacheTtlMs,
      mtimeMs: stat?.mtimeMs ?? Date.now(),
    });
  }

  private pathFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`);
  }

  private async safeStat(taskId: string): Promise<{ mtimeMs: number } | undefined> {
    try {
      const stat = await fs.stat(this.pathFor(taskId));
      return { mtimeMs: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }
}

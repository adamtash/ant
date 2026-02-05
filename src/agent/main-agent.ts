/**
 * Main Agent - Autonomous Supervisor
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { type AntConfig } from "../config.js";
import { type AgentEngine } from "./engine.js";
import { type Logger } from "../log.js";
import { type SessionManager } from "../gateway/session-manager.js";
import { createEventPublishers, getEventStream } from "../monitor/event-stream.js";
import { TaskStore } from "./task/task-store.js";
import type { TaskEntry, TaskResult, TaskState } from "./task/types.js";
import { TaskQueue } from "./concurrency/task-queue.js";
import { TaskLane } from "./concurrency/lanes.js";
import { TimeoutMonitor } from "./concurrency/timeout-monitor.js";
import { PhaseExecutor } from "./subagent/phase-executor.js";
import { DEFAULT_SUBAGENT_PHASES } from "./subagent/execution-phases.js";
import { ProviderDiscoveryService } from "./duties/provider-discovery-service.js";
import {
  DEFAULT_AGENT_ID,
  buildAgentScopedSessionKey,
  buildAgentSubagentSessionKey,
  buildAgentTaskSessionKey,
} from "../routing/session-key.js";

export type MainAgentTask = TaskEntry;

export interface MainAgentSendMessage {
  (jid: string, message: string): Promise<void>;
}

export class MainAgent {
  private _config: AntConfig;
  private agentEngine: AgentEngine;
  private logger: Logger;
  private sendMessage?: MainAgentSendMessage;
  private sessionManager?: SessionManager;
  private running = false;
  private paused = false;
  private timer: NodeJS.Timeout | null = null;
  private startupHealthCheckDone = false;
  private taskStore: TaskStore;
  private taskQueue: TaskQueue;
  private timeoutMonitor: TimeoutMonitor;
  private phaseExecutor: PhaseExecutor;
  private autonomousRunning = false;
  private readonly agentId: string;
  private lastErrorScanAt = Date.now();
  private errorScanTimer: NodeJS.Timeout | null = null;
  private errorScanInFlight = false;
  private readonly errorInvestigationCooldownMs = 15 * 60 * 1000;
  private readonly investigatedErrors = new Map<string, number>();
  private readonly incidentTasks = new Map<string, { summary: string }>();
  private readonly providerDiscovery: ProviderDiscoveryService;
  private survivalMode = false;
  private lastSurvivalAttemptAt = 0;
  private lastProviderDiscoveryAt = 0;
  private lastProviderHealthCheckAt = 0;
  private readonly survivalAttemptCooldownMs = 5 * 60 * 1000;

  constructor(params: {
    config: AntConfig;
    agentEngine: AgentEngine;
    logger: Logger;
    sendMessage?: MainAgentSendMessage;
    sessionManager?: SessionManager;
  }) {
    this._config = params.config;
    this.agentEngine = params.agentEngine;
    this.sendMessage = params.sendMessage;
    this.sessionManager = params.sessionManager;
    this.logger = params.logger.child({ component: "main-agent" });
    this.agentId = DEFAULT_AGENT_ID;

    const taskConfig = this.config.agentExecution?.tasks;
    const laneConfig = this.config.agentExecution?.lanes;
    const cacheTtlMs = taskConfig?.registry?.cacheTtlMs ?? 45_000;
    const configuredDir = taskConfig?.registry?.dir;
    const taskDir = configuredDir
      ? (path.isAbsolute(configuredDir)
          ? configuredDir
          : path.resolve(this.config.resolved.workspaceDir, configuredDir))
      : undefined;

    this.taskStore = new TaskStore({
      stateDir: this.config.resolved.stateDir,
      taskDir,
      logger: this.logger,
      cacheTtlMs,
    });

    this.taskQueue = new TaskQueue({
      logger: this.logger,
      laneLimits: {
        [TaskLane.Main]: laneConfig?.main?.maxConcurrent ?? 1,
        [TaskLane.Autonomous]: laneConfig?.autonomous?.maxConcurrent ?? 5,
        [TaskLane.Maintenance]: laneConfig?.maintenance?.maxConcurrent ?? 1,
      },
    });

    this.phaseExecutor = new PhaseExecutor({
      agentEngine: this.agentEngine,
      logger: this.logger,
      taskStore: this.taskStore,
    });

    this.timeoutMonitor = new TimeoutMonitor({
      logger: this.logger,
      taskStore: this.taskStore,
      intervalMs: this.config.agentExecution?.monitoring?.timeoutCheckIntervalMs ?? 1000,
      onWarning: async (task, msUntilTimeout) => {
        await createEventPublishers(getEventStream()).taskTimeoutWarning({
          taskId: task.taskId,
          msUntilTimeout,
        }, { sessionKey: task.sessionKey, channel: task.metadata.channel });
      },
      onTimeout: async (task, reason) => {
        await this.handleTimeout(task, reason);
      },
    });

    this.providerDiscovery = new ProviderDiscoveryService({
      cfg: this.config,
      agentEngine: this.agentEngine,
      logger: this.logger,
    });
  }

  get config(): AntConfig {
    return this._config;
  }

  set config(next: AntConfig) {
    this._config = next;
    this.providerDiscovery.setConfig(next);
    this.restartErrorScanLoop();
  }

  async start(): Promise<void> {
    if (!this.config.mainAgent?.enabled) {
      this.logger.info("Main Agent disabled");
      return;
    }

    await this.taskStore.initialize();
    this.timeoutMonitor.start();

    this.running = true;
    this.paused = false;
    this.lastErrorScanAt = Date.now();
    this.lastProviderDiscoveryAt = 0;
    this.lastProviderHealthCheckAt = 0;
    this.logger.info("Main Agent loop started - Autonomous mode enabled");

    await this.restoreActiveTasksOnStartup();
    await this.sendStartupMessage();
    await this.runStartupHealthCheck();

    this.restartErrorScanLoop();
    this.runCycle();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.timeoutMonitor.stop();
    this.stopErrorScanLoop();
    if (this.timer) clearTimeout(this.timer);
    this.logger.info("Main Agent loop stopped");
  }

  pause(): void {
    this.paused = true;
    this.logger.info("Main Agent paused");
  }

  resume(): void {
    if (!this.running) return;
    this.paused = false;
    this.logger.info("Main Agent resumed");
  }

  isPaused(): boolean {
    return this.paused;
  }

  async assignTask(description: string, maxRetries?: number): Promise<string> {
    const retries = maxRetries ?? this.config.agentExecution?.tasks?.defaults?.maxRetries ?? 3;
    const sessionKey = buildAgentTaskSessionKey({
      agentId: this.agentId,
      taskId: crypto.randomUUID(),
    });

    const task = await this.taskStore.create({
      description,
      sessionKey,
      lane: TaskLane.Main,
      metadata: {
        channel: "cli",
        priority: "high",
        tags: [],
      },
      retries: { maxAttempts: retries },
      timeoutMs: this.config.agentExecution?.tasks?.defaults?.timeoutMs ?? 120_000,
    });

    await this.enqueueTask(task, TaskLane.Main);
    this.logger.info({ taskId: task.taskId }, "New task assigned to Main Agent");

    return task.taskId;
  }

  async assignMaintenanceTask(
    description: string,
    maxRetries?: number,
    opts?: { tags?: string[] },
  ): Promise<string> {
    const retries = maxRetries ?? this.config.agentExecution?.tasks?.defaults?.maxRetries ?? 3;
    const sessionKey = buildAgentTaskSessionKey({
      agentId: this.agentId,
      taskId: crypto.randomUUID(),
    });

    const tags = Array.isArray(opts?.tags) ? opts?.tags : ["investigation"];
    const task = await this.taskStore.create({
      description,
      sessionKey,
      lane: TaskLane.Maintenance,
      metadata: {
        channel: "cli",
        priority: "high",
        tags,
      },
      retries: { maxAttempts: retries },
      timeoutMs: this.config.agentExecution?.tasks?.defaults?.timeoutMs ?? 120_000,
    });

    await this.enqueueTask(task, TaskLane.Maintenance);
    this.logger.info({ taskId: task.taskId }, "New maintenance task assigned to Main Agent");

    return task.taskId;
  }

  async getTask(taskId: string): Promise<MainAgentTask | undefined> {
    return this.taskStore.get(taskId);
  }

  async getAllTasks(): Promise<MainAgentTask[]> {
    return this.taskStore.list();
  }

  private async enqueueTask(task: TaskEntry, lane: TaskLane): Promise<void> {
    await this.taskStore.updateStatus(task.taskId, "queued");
    this.taskQueue.enqueue(task, lane, async () => this.runTask(task.taskId));
  }

  private async runTask(taskId: string): Promise<TaskResult> {
    const task = await this.taskStore.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    await this.taskStore.updateStatus(task.taskId, "running");

    try {
      const subTask = await this.spawnSubagent(task);
      const timeoutMs = this.config.agentExecution?.subagents?.timeoutMs ?? 120_000;
      const result = await this.taskQueue.waitForCompletion(subTask.taskId, timeoutMs);

      await this.taskStore.setResult(task.taskId, result);
      await this.taskStore.updateStatus(task.taskId, "succeeded");
      await this.maybeNotifyIncidentResult(task, { ok: true, result });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.handleFailure(task, error);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private async spawnSubagent(parentTask: TaskEntry): Promise<TaskEntry> {
    const sessionKey = buildAgentSubagentSessionKey({
      agentId: this.agentId,
      subagentId: crypto.randomUUID(),
      parentTaskId: parentTask.taskId,
    });
    const subTask = await this.taskStore.create({
      parentTaskId: parentTask.taskId,
      description: parentTask.description,
      sessionKey,
      lane: TaskLane.Autonomous,
      metadata: {
        channel: parentTask.metadata.channel,
        priority: "normal",
        tags: parentTask.metadata.tags,
      },
      retries: { maxAttempts: this.config.agentExecution?.subagents?.maxRetries ?? 2 },
      timeoutMs: this.config.agentExecution?.subagents?.timeoutMs ?? 120_000,
    });

    await this.taskStore.update(parentTask.taskId, { subagentSessionKey: sessionKey });

    await createEventPublishers(getEventStream()).subagentSpawned(
      {
        subagentId: subTask.taskId,
        task: subTask.description,
        parentSessionKey: parentTask.sessionKey,
        parentTaskId: parentTask.taskId,
      },
      { sessionKey: parentTask.sessionKey, channel: parentTask.metadata.channel }
    );

    await this.taskStore.updateStatus(subTask.taskId, "queued");

    this.taskQueue.enqueue(subTask, TaskLane.Autonomous, async () => {
      const fresh = await this.taskStore.get(subTask.taskId);
      if (!fresh) throw new Error(`Subtask not found: ${subTask.taskId}`);

      await this.taskStore.updateStatus(fresh.taskId, "running");

      try {
        const result = await this.phaseExecutor.execute(fresh, DEFAULT_SUBAGENT_PHASES);
        await this.taskStore.setResult(fresh.taskId, result);
        await this.taskStore.updateStatus(fresh.taskId, "succeeded");
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        await this.taskStore.update(fresh.taskId, { error });
        await this.taskStore.updateStatus(fresh.taskId, "failed", error);
        throw err instanceof Error ? err : new Error(String(err));
      }
    });

    return subTask;
  }

  private async handleFailure(task: TaskEntry, error: string): Promise<void> {
    const attempted = task.retries.attempted + 1;
    const maxAttempts = task.retries.maxAttempts;

    if (attempted >= maxAttempts) {
      await this.taskStore.update(task.taskId, { error });
      await this.taskStore.updateStatus(task.taskId, "failed", error);
      await this.maybeNotifyIncidentResult(task, { ok: false, error });
      return;
    }

    const defaults = this.config.agentExecution?.tasks?.defaults;
    const base = defaults?.retryBackoffMs ?? 1000;
    const multiplier = defaults?.retryBackoffMultiplier ?? 2;
    const cap = defaults?.retryBackoffCap ?? 60_000;
    const backoffMs = Math.min(base * Math.pow(multiplier, attempted - 1), cap);
    const nextRetryAt = Date.now() + backoffMs;

    await this.taskStore.update(task.taskId, {
      retries: {
        ...task.retries,
        attempted,
        nextRetryAt,
        backoffMs,
      },
      error,
    });

    await this.taskStore.updateStatus(task.taskId, "retrying", error);

    await createEventPublishers(getEventStream()).taskRetryScheduled({
      taskId: task.taskId,
      attempt: attempted,
      nextRetryAt,
      backoffMs,
    }, { sessionKey: task.sessionKey, channel: task.metadata.channel });

    this.taskQueue.enqueueWithDelay(
      task,
      TaskLane.Main,
      async () => {
        await this.taskStore.updateStatus(task.taskId, "queued");
        return this.runTask(task.taskId);
      },
      backoffMs
    );
  }

  private async handleTimeout(task: TaskEntry, reason: string): Promise<void> {
    await this.taskStore.update(task.taskId, { error: reason });
    await this.taskStore.updateStatus(task.taskId, "failed", reason);
    await this.maybeNotifyIncidentResult(task, { ok: false, error: reason });

    await createEventPublishers(getEventStream()).taskTimeout({
      taskId: task.taskId,
      reason,
      timestamp: Date.now(),
    }, { sessionKey: task.sessionKey, channel: task.metadata.channel });
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;
    if (this.paused) {
      this.scheduleNext_();
      return;
    }

    try {
      await this.runProviderMaintenance();
      const active = await this.taskStore.getActiveTasks();
      if (active.length === 0 && !this.autonomousRunning) {
        this.autonomousRunning = true;
        await this.runAutonomousDuties();
        this.autonomousRunning = false;
      }
    } catch (err) {
      this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Main Agent cycle failed");
    }

    this.scheduleNext_();
  }

  private getProviderDiscoverySettings(): {
    enabled: boolean;
    researchIntervalHours: number;
    healthCheckIntervalMinutes: number;
    minBackupProviders: number;
  } {
    const discovery = (this.config.resolved.providers as any).discovery ?? {};
    return {
      enabled: Boolean(discovery.enabled),
      researchIntervalHours:
        typeof discovery.researchIntervalHours === "number" && discovery.researchIntervalHours > 0
          ? discovery.researchIntervalHours
          : 24,
      healthCheckIntervalMinutes:
        typeof discovery.healthCheckIntervalMinutes === "number" && discovery.healthCheckIntervalMinutes > 0
          ? discovery.healthCheckIntervalMinutes
          : 120,
      minBackupProviders:
        typeof discovery.minBackupProviders === "number" && discovery.minBackupProviders >= 0
          ? discovery.minBackupProviders
          : 1,
    };
  }

  private async runProviderMaintenance(): Promise<void> {
    if (ProviderDiscoveryService.isDisabledByEnv()) return;

    const now = Date.now();
    const settings = this.getProviderDiscoverySettings();

    const healthy = await this.agentEngine.hasHealthyProvider();
    if (!healthy) {
      const shouldAttempt = now - this.lastSurvivalAttemptAt >= this.survivalAttemptCooldownMs;
      if (!this.survivalMode) {
        this.survivalMode = true;
        await this.notifyOwners(
          "⚠️ All providers appear down. Entering survival mode and attempting recovery.",
          { kind: "providers" },
        );
      }
      if (shouldAttempt) {
        this.lastSurvivalAttemptAt = now;
        try {
          await this.providerDiscovery.runDiscovery({ mode: "emergency" });
        } catch (err) {
          this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Emergency provider discovery failed");
        }
      }
      const recovered = await this.agentEngine.hasHealthyProvider();
      if (recovered) {
        this.survivalMode = false;
        await this.notifyOwners("✅ Provider recovery succeeded. Survival mode cleared.", { kind: "providers" });
      }
      return;
    }

    if (this.survivalMode) {
      this.survivalMode = false;
      await this.notifyOwners("✅ Providers recovered. Survival mode cleared.", { kind: "providers" });
    }

    if (!settings.enabled) return;

    const healthIntervalMs = settings.healthCheckIntervalMinutes * 60 * 1000;
    if (now - this.lastProviderHealthCheckAt >= healthIntervalMs) {
      this.lastProviderHealthCheckAt = now;
      try {
        const result = await this.providerDiscovery.runHealthCheck();
        if (result.ok && result.removedIds && result.removedIds.length > 0) {
          await this.notifyOwners(
            `🩺 Provider health: removed failing providers: ${result.removedIds.join(", ")}`,
            { kind: "providers" },
          );
        }
      } catch (err) {
        this.logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Provider health check failed");
      }
    }

    const researchIntervalMs = settings.researchIntervalHours * 60 * 60 * 1000;
    if (now - this.lastProviderDiscoveryAt >= researchIntervalMs) {
      this.lastProviderDiscoveryAt = now;
      try {
        const result = await this.providerDiscovery.runDiscovery({ mode: "scheduled" });
        if (result.ok && result.overlay) {
          const added = result.summary?.added ?? [];
          const removed = result.summary?.removed ?? [];
          if (added.length > 0 || removed.length > 0) {
            const parts: string[] = [];
            if (added.length > 0) parts.push(`Added: ${added.join(", ")}`);
            if (removed.length > 0) parts.push(`Removed: ${removed.join(", ")}`);
            await this.notifyOwners(
              `🛰️ Provider discovery update\n\n${parts.join("\n")}`,
              { kind: "providers" },
            );
          }

          const providerCount = Object.keys(result.overlay.providers).length;
          if (providerCount < settings.minBackupProviders) {
            await this.notifyOwners(
              `⚠️ Provider discovery: only ${providerCount}/${settings.minBackupProviders} backup providers verified. Set API key/model env vars or enable local runtimes.`,
              { kind: "providers" },
            );
          }
        }
      } catch (err) {
        this.logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Scheduled provider discovery failed");
      }
    }
  }

  private async restoreActiveTasksOnStartup(): Promise<void> {
    try {
      const active = await this.taskStore.getActiveTasks();
      if (active.length === 0) return;

      this.logger.info({ count: active.length }, "Restoring active tasks on startup");
      const now = Date.now();

      for (const task of active) {
        const lane = task.lane === "maintenance"
          ? TaskLane.Maintenance
          : task.lane === "autonomous"
            ? TaskLane.Autonomous
            : TaskLane.Main;

        const delayMs =
          task.status === "retrying" && task.retries.nextRetryAt && task.retries.nextRetryAt > now
            ? task.retries.nextRetryAt - now
            : 0;

        await this.taskStore.updateStatus(task.taskId, "queued", "resume_after_restart");
        if (delayMs > 0) {
          this.taskQueue.enqueueWithDelay(
            task,
            lane,
            async () => this.runTask(task.taskId),
            delayMs
          );
        } else {
          this.taskQueue.enqueue(task, lane, async () => this.runTask(task.taskId));
        }
      }
    } catch (err) {
      this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Failed restoring active tasks");
    }
  }

  private async scanForErrorsAndSpawnInvestigations(): Promise<void> {
    const now = Date.now();
    const scanSince = this.lastErrorScanAt;
    this.lastErrorScanAt = now;

    const logPath = this.config.resolved.logFilePath;
    const errors = await this.scanLogForErrors(logPath, scanSince);
    if (errors.length === 0) return;

    const maxPerCycle = 2;
    let spawned = 0;

    for (const err of errors) {
      if (spawned >= maxPerCycle) break;

      const key = err.signature;
      const last = this.investigatedErrors.get(key) ?? 0;
      if (now - last < this.errorInvestigationCooldownMs) continue;

      this.investigatedErrors.set(key, now);

      const description = `${err.summary}\n\n${err.details}\n\n${(await import("./templates/investigation.js")).INVESTIGATION_SUBAGENT_PROMPT}`;
      const taskId = await this.assignMaintenanceTask(description, 2, { tags: ["incident", "investigation"] });
      spawned += 1;

      this.incidentTasks.set(taskId, { summary: err.summary });

      await this.notifyOwners(
        `🔍 Detected error. Starting investigation.\n\n*Task*: ${taskId}\n*Summary*: ${err.summary}`,
        { kind: "errors" },
      );
    }
  }

  private async notifyOwners(
    message: string,
    opts?: { kind?: keyof AntConfig["mainAgent"]["notifyOn"]; force?: boolean },
  ): Promise<void> {
    if (!this.sendMessage) return;
    const kind = opts?.kind;
    if (!opts?.force && kind && this.config.mainAgent?.notifyOn?.[kind] === false) {
      return;
    }

    const explicit = this.config.mainAgent?.notifySessions ?? [];
    const ownerJids = this.config.whatsapp?.ownerJids || [];
    const startupRecipients = this.config.whatsapp?.startupRecipients || [];
    const fallback = startupRecipients.length > 0 ? startupRecipients : ownerJids;
    const recipients = Array.from(
      new Set(
        [...explicit, ...fallback]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );

    if (recipients.length === 0) return;

    for (const jid of recipients) {
      try {
        await this.sendMessage(jid, message);
      } catch (err) {
        this.logger.debug({ error: err instanceof Error ? err.message : String(err), jid }, "Failed to notify owner");
      }
    }
  }

  private restartErrorScanLoop(): void {
    this.stopErrorScanLoop();
    if (!this.running) return;
    const intervalMs = this.config.mainAgent?.errorScanIntervalMs ?? 30_000;
    this.errorScanTimer = setInterval(() => {
      void this.tickErrorScan();
    }, Math.max(1000, intervalMs));
    this.errorScanTimer.unref?.();
  }

  private stopErrorScanLoop(): void {
    if (this.errorScanTimer) {
      clearInterval(this.errorScanTimer);
      this.errorScanTimer = null;
    }
  }

  private async tickErrorScan(): Promise<void> {
    if (!this.running) return;
    if (this.paused) return;
    if (this.errorScanInFlight) return;
    this.errorScanInFlight = true;
    try {
      await this.scanForErrorsAndSpawnInvestigations();
    } finally {
      this.errorScanInFlight = false;
    }
  }

  private async maybeNotifyIncidentResult(
    task: TaskEntry,
    outcome: { ok: true; result: TaskResult } | { ok: false; error: string },
  ): Promise<void> {
    if (!this.config.mainAgent?.notifyOn?.incidentResults) return;
    if (!task.metadata?.tags?.includes("incident")) return;

    const tracked = this.incidentTasks.get(task.taskId);
    const summary = tracked?.summary || "incident";

    if (outcome.ok) {
      this.incidentTasks.delete(task.taskId);
      const snippet = summarizeText(outcome.result.content, 900);
      const tools = outcome.result.toolsUsed?.length ? `\n*Tools*: ${outcome.result.toolsUsed.join(", ")}` : "";
      await this.notifyOwners(
        `✅ Investigation complete.\n\n*Task*: ${task.taskId}\n*Summary*: ${summary}${tools}\n\n${snippet}`,
        { kind: "incidentResults" },
      );
      return;
    }

    this.incidentTasks.delete(task.taskId);
    await this.notifyOwners(
      `❌ Investigation failed.\n\n*Task*: ${task.taskId}\n*Summary*: ${summary}\n*Error*: ${outcome.error}`,
      { kind: "incidentResults" },
    );
  }

  private async maybeNotifyAutonomousUpdate(response: string): Promise<void> {
    if (!this.config.mainAgent?.notifyOn?.improvements) return;
    const raw = String(response || "");
    if (!raw) return;
    const shouldNotify =
      raw.includes("<promise>ISSUES_FOUND</promise>") || raw.includes("<promise>IMPROVEMENT_IDEA</promise>");
    if (!shouldNotify) return;

    const match = raw.match(/<owner_update>\s*([\s\S]*?)\s*<\/owner_update>/i);
    const update = (match?.[1] || "").trim();
    const fallback = summarizeText(stripPromises(raw), 900);

    await this.notifyOwners(
      `🧠 Main Agent update\n\n${update || fallback}`,
      { kind: "improvements" },
    );
  }

  private async scanLogForErrors(
    logFilePath: string,
    sinceTs: number,
  ): Promise<Array<{ signature: string; summary: string; details: string }>> {
    try {
      const stat = await fs.stat(logFilePath);
      if (stat.size === 0) return [];

      const maxBytes = 256_000;
      const start = Math.max(0, stat.size - maxBytes);
      const fh = await fs.open(logFilePath, "r");
      try {
        const buffer = Buffer.alloc(stat.size - start);
        await fh.read(buffer, 0, buffer.length, start);
        const text = buffer.toString("utf-8");
        const lines = text.split("\n").filter(Boolean);

        const found: Array<{ signature: string; summary: string; details: string }> = [];
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i] ?? "";
          let entry: any;
          try {
            entry = JSON.parse(line);
          } catch {
            continue;
          }
          const ts = typeof entry.time === "number" ? entry.time : typeof entry.timestamp === "number" ? entry.timestamp : 0;
          if (sinceTs && ts && ts <= sinceTs) break;

          const level = typeof entry.level === "number" ? entry.level : 0;
          if (level < 50) continue;

          const msg = typeof entry.msg === "string" ? entry.msg : "error";
          const errMsg =
            typeof entry.error === "string"
              ? entry.error
              : entry.err && typeof entry.err === "object" && typeof entry.err.message === "string"
                ? entry.err.message
                : "";
          const providerId = typeof entry.providerId === "string" ? entry.providerId : undefined;
          const model = typeof entry.model === "string" ? entry.model : undefined;

          const summary = providerId ? `${msg} (${providerId}${model ? `/${model}` : ""})` : msg;
          const details = errMsg ? `Error: ${errMsg}` : `Log: ${line.slice(0, 1000)}`;
          const signature = crypto.createHash("sha256").update(summary + "\n" + details).digest("hex");

          found.push({ signature, summary, details });
          if (found.length >= 5) break;
        }

        return found;
      } finally {
        await fh.close();
      }
    } catch {
      return [];
    }
  }

  private async sendStartupMessage(): Promise<void> {
    const message = "🤖 *Queen Ant Started*\n\nAutonomous work mode is now active!";
    await this.notifyOwners(message, { force: true });
  }

  private async runStartupHealthCheck(): Promise<void> {
    if (this.startupHealthCheckDone) return;

    this.logger.info("Running startup health check...");

    try {
      const duties = await this.loadDuties();

      const sessionKey = buildAgentScopedSessionKey({
        agentId: this.agentId,
        scope: "startup-health",
      });
      const result = await this.agentEngine.execute({
        query: `You are the Main Agent running a STARTUP HEALTH CHECK.\n\nPerform a comprehensive system health check and report the status:\n\nHEALTH CHECK ITEMS:\n1. **System Status**: Check if all components are running\n   - Gateway server\n   - WhatsApp connection  \n   - Agent engine\n   - Memory system\n\n2. **Diagnostics**: Run system diagnostics\n   - Check disk usage in .ant/ directory\n   - Review recent logs for errors\n   - Verify provider connectivity\n\n3. **Test Basic Operations**:\n   - Try a simple memory search to verify embeddings\n   - Check if tools are accessible\n\n4. **Summary Report**: Provide a concise health report with:\n   - ✅ Working components\n   - ⚠️ Warnings (if any)\n   - ❌ Issues found (if any)\n\nFORMAT YOUR RESPONSE FOR WHATSAPP:\nKeep it concise and readable. Use emoji indicators.\nExample:\n🤖 *Startup Health Check*\n\n✅ Gateway: Running\n✅ WhatsApp: Connected\n✅ Agent Engine: Ready\n⚠️ Memory: 234 MB (12% usage)\n\nSystem is healthy and ready!`,
        sessionKey,
        chatId: "system",
        channel: "cli",
      });

      await this.persistMessage(
        sessionKey,
        "assistant",
        result.response,
        result.providerId,
        result.model
      );

      this.startupHealthCheckDone = true;
      await this.notifyOwners(result.response || "🤖 Startup health check completed.", { force: true });
    } catch (err) {
      this.logger.error({ error: err }, "Startup health check failed");

      await this.notifyOwners(
        `🤖 *Startup Health Check*\n\n❌ Health check failed:\n${err instanceof Error ? err.message : String(err)}`,
        { force: true },
      );
    }
  }

  private async runAutonomousDuties(): Promise<void> {
    const duties = await this.loadDuties();

    const sessionKey = buildAgentScopedSessionKey({
      agentId: this.agentId,
      scope: "system",
    });
    const result = await this.agentEngine.execute({
      query: `Execute your duties as the Autonomous Main Agent.\n\nPHILOSOPHY: Work like an expert software engineer - investigate, fix, test, iterate.\n\nCurrent Duties:\n${duties}\n\nAUTONOMOUS WORKFLOW:\n1. CHECK: Run diagnostics to find issues\n   - Check logs for errors\n   - Test endpoints\n   - Verify WhatsApp connectivity\n\n2. INVESTIGATE: If issues found\n   - Read relevant code\n   - Analyze root cause\n   - Search memory for context\n\n3. FIX: Implement solution\n   - Make minimal changes\n   - Follow existing patterns\n   - Update tests if needed\n\n4. TEST: Verify the fix\n   - Run tests\n   - Check functionality\n   - Confirm resolution\n\n5. IMPROVE: Look for enhancements\n   - Code quality improvements\n   - Performance optimizations\n   - Better error handling\n\n6. REPORT: Log actions taken\n   - What was checked\n   - What was found\n   - What was done\n   - Results\n\nOUTPUT RULES:\n- Output <promise>DUTY_CYCLE_COMPLETE</promise> when finished.\n- Output <promise>ISSUES_FOUND</promise> if you found and fixed issues.\n- Output <promise>IMPROVEMENT_IDEA</promise> if you have a notable improvement idea worth notifying the owner.\n- If you output ISSUES_FOUND or IMPROVEMENT_IDEA, include a short owner update block:\n  <owner_update>\n  - 1-6 bullet points\n  </owner_update>\n  Do NOT include secrets or tokens.\n`,
      sessionKey,
      chatId: "system",
      channel: "cli",
    });

    await this.persistMessage(
      sessionKey,
      "assistant",
      result.response,
      result.providerId,
      result.model
    );

    await this.maybeNotifyAutonomousUpdate(result.response);
    this.logger.info("Main Agent duty cycle complete");
  }

  private async loadDuties(): Promise<string> {
    const dutiesFile = this.config.mainAgent.dutiesFile || "AGENT_DUTIES.md";
    const dutiesPath = path.join(this.config.resolved.workspaceDir, dutiesFile);

    try {
      return await fs.readFile(dutiesPath, "utf-8");
    } catch {
      const configDir = path.dirname(this.config.resolved.configPath);
      const fallbackPath = path.join(configDir, dutiesFile);
      try {
        return await fs.readFile(fallbackPath, "utf-8");
      } catch {
        this.logger.debug("Using default duties");
        return this.getDefaultDuties();
      }
    }
  }

  private scheduleNext_(): void {
    if (this.running) {
      const interval = this.config.mainAgent.intervalMs || 60000;
      this.timer = setTimeout(() => this.runCycle(), interval);
    }
  }

  private getDefaultDuties(): string {
    return `# Autonomous Main Agent Duties\n\n## System Health Monitoring\n\n1. Run diagnostics: \`ant diagnostics test-all\`\n2. Check logs for errors and warnings\n3. Verify all services are running:\n   - Gateway HTTP API\n   - WhatsApp connection\n   - Agent engine\n4. Monitor resource usage (memory, CPU)\n\n## Self-Improvement Loop\n\n1. Review recent error patterns in logs\n2. Identify flaky tests or failures\n3. Look for code quality issues\n4. Check for outdated dependencies\n5. Optimize slow operations\n\n## Proactive Maintenance\n\n1. Clean up old session data (>30 days)\n2. Archive completed tasks\n3. Update memory indexes\n4. Verify backup systems\n5. Check disk space\n\n## Investigation Protocol\n\nWhen issues are found:\n1. Read relevant source files\n2. Check test coverage\n3. Analyze error patterns\n4. Search memory for similar issues\n5. Propose and implement fixes\n6. Test the solution\n7. Document the resolution\n\n## Autonomous Actions\n\nYou are empowered to:\n- Read any file in the project\n- Write fixes to source files\n- Run tests and builds\n- Execute diagnostics\n- Search memory and logs\n- Create new tasks for complex issues\n\nAlways:\n- Make minimal, focused changes\n- Follow existing code patterns\n- Test before declaring success\n- Report what you did and why\n`;
  }

  private async persistMessage(
    sessionKey: string,
    role: "user" | "assistant",
    content: string,
    providerId?: string,
    model?: string
  ): Promise<void> {
    if (!this.sessionManager) return;

    try {
      await this.sessionManager.appendMessage(sessionKey, {
        role,
        content,
        timestamp: Date.now(),
        providerId,
        model,
      });
    } catch (err) {
      this.logger.warn({ error: err, sessionKey }, "Failed to persist Main Agent message");
    }
  }
}

function stripPromises(text: string): string {
  return String(text || "").replace(/<promise>[^<]*<\/promise>/gi, "").trim();
}

function summarizeText(text: string, maxLen: number): string {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen).trimEnd() + "…";
}

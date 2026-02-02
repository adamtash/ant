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
  public config: AntConfig;
  private agentEngine: AgentEngine;
  private logger: Logger;
  private sendMessage?: MainAgentSendMessage;
  private sessionManager?: SessionManager;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private startupHealthCheckDone = false;
  private taskStore: TaskStore;
  private taskQueue: TaskQueue;
  private timeoutMonitor: TimeoutMonitor;
  private phaseExecutor: PhaseExecutor;
  private autonomousRunning = false;
  private readonly agentId: string;

  constructor(params: {
    config: AntConfig;
    agentEngine: AgentEngine;
    logger: Logger;
    sendMessage?: MainAgentSendMessage;
    sessionManager?: SessionManager;
  }) {
    this.config = params.config;
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
  }

  async start(): Promise<void> {
    if (!this.config.mainAgent?.enabled) {
      this.logger.info("Main Agent disabled");
      return;
    }

    await this.taskStore.initialize();
    this.timeoutMonitor.start();

    this.running = true;
    this.logger.info("Main Agent loop started - Autonomous mode enabled");

    await this.sendStartupMessage();
    await this.runStartupHealthCheck();

    this.runCycle();
  }

  stop(): void {
    this.running = false;
    this.timeoutMonitor.stop();
    if (this.timer) clearTimeout(this.timer);
    this.logger.info("Main Agent loop stopped");
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

    await createEventPublishers(getEventStream()).taskTimeout({
      taskId: task.taskId,
      reason,
      timestamp: Date.now(),
    }, { sessionKey: task.sessionKey, channel: task.metadata.channel });
  }

  private async runCycle(): Promise<void> {
    if (!this.running) return;

    try {
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

  private async sendStartupMessage(): Promise<void> {
    const ownerJids = this.config.whatsapp?.ownerJids || [];
    const startupRecipients = this.config.whatsapp?.startupRecipients || [];
    const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;

    if (recipients.length === 0 || !this.sendMessage) {
      this.logger.debug("No WhatsApp recipients configured for startup message");
      return;
    }

    const message = "🤖 *Queen Ant Started*\n\nAutonomous work mode is now active!";

    for (const jid of recipients) {
      try {
        await this.sendMessage(jid, message);
        this.logger.info({ jid }, "Startup message sent to owner");
      } catch (err) {
        this.logger.warn({ error: err, jid }, "Failed to send startup message to owner");
      }
    }
  }

  private async runStartupHealthCheck(): Promise<void> {
    if (this.startupHealthCheckDone) return;

    this.logger.info("Running startup health check...");

    const ownerJids = this.config.whatsapp?.ownerJids || [];
    const startupRecipients = this.config.whatsapp?.startupRecipients || [];
    const recipients = startupRecipients.length > 0 ? startupRecipients : ownerJids;

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

      if (recipients.length > 0 && this.sendMessage) {
        const message = result.response || "🤖 Startup health check completed.";

        for (const jid of recipients) {
          try {
            await this.sendMessage(jid, message);
            this.logger.info({ jid }, "Startup health check sent to owner");
          } catch (err) {
            this.logger.warn({ error: err, jid }, "Failed to send health check to owner");
          }
        }
      } else {
        this.logger.info("No WhatsApp recipients configured for startup health check");
      }
    } catch (err) {
      this.logger.error({ error: err }, "Startup health check failed");

      if (recipients.length > 0 && this.sendMessage) {
        const errorMessage = `🤖 *Startup Health Check*\n\n❌ Health check failed:\n${err instanceof Error ? err.message : String(err)}`;

        for (const jid of recipients) {
          try {
            await this.sendMessage(jid, errorMessage);
          } catch {
            // Ignore send errors
          }
        }
      }
    }
  }

  private async runAutonomousDuties(): Promise<void> {
    const duties = await this.loadDuties();

    const sessionKey = buildAgentScopedSessionKey({
      agentId: this.agentId,
      scope: "system",
    });
    const result = await this.agentEngine.execute({
      query: `Execute your duties as the Autonomous Main Agent.\n\nPHILOSOPHY: Work like an expert software engineer - investigate, fix, test, iterate.\n\nCurrent Duties:\n${duties}\n\nAUTONOMOUS WORKFLOW:\n1. CHECK: Run diagnostics to find issues\n   - Check logs for errors\n   - Test endpoints\n   - Verify WhatsApp connectivity\n\n2. INVESTIGATE: If issues found\n   - Read relevant code\n   - Analyze root cause\n   - Search memory for context\n\n3. FIX: Implement solution\n   - Make minimal changes\n   - Follow existing patterns\n   - Update tests if needed\n\n4. TEST: Verify the fix\n   - Run tests\n   - Check functionality\n   - Confirm resolution\n\n5. IMPROVE: Look for enhancements\n   - Code quality improvements\n   - Performance optimizations\n   - Better error handling\n\n6. REPORT: Log actions taken\n   - What was checked\n   - What was found\n   - What was done\n   - Results\n\nOutput <promise>DUTY_CYCLE_COMPLETE</promise> when finished.\nOutput <promise>ISSUES_FOUND</promise> if you found and fixed issues.`,
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

/**
 * Job Executor - Executes individual scheduled jobs
 *
 * Handles trigger execution, action processing, retry logic, and timeout management.
 */

import type {
  ScheduledJob,
  JobExecutionContext,
  JobExecutionResult,
  JobTrigger,
  JobAction,
  AgentExecutor,
  ToolExecutor,
  MessageSender,
  MemoryUpdater,
} from "./types.js";
import type { Logger } from "../log.js";

/**
 * Executor dependencies
 */
export interface ExecutorDependencies {
  agentExecutor?: AgentExecutor;
  toolExecutor?: ToolExecutor;
  messageSender?: MessageSender;
  memoryUpdater?: MemoryUpdater;
}

/**
 * Job Executor - handles execution of scheduled jobs
 */
export class JobExecutor {
  private readonly logger: Logger;
  private readonly deps: ExecutorDependencies;

  constructor(logger: Logger, deps: ExecutorDependencies) {
    this.logger = logger.child({ component: "job-executor" });
    this.deps = deps;
  }

  /**
   * Execute a job with full lifecycle management
   */
  async execute(ctx: JobExecutionContext): Promise<JobExecutionResult> {
    const startTime = Date.now();
    const { job, retryCount } = ctx;

    this.logger.info(
      { jobId: job.id, name: job.name, retryCount },
      "Starting job execution"
    );

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(
        () => this.executeTrigger(job.trigger, ctx),
        job.timeout
      );

      // Process actions on success
      if (result.success && job.actions.length > 0) {
        await this.processActions(job.actions, result.output, ctx);
      }

      const duration = Date.now() - startTime;
      this.logger.info(
        { jobId: job.id, duration, success: result.success },
        "Job execution completed"
      );

      return {
        success: result.success,
        output: result.output,
        error: result.error,
        duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.logger.error(
        { jobId: job.id, error, duration, retryCount },
        "Job execution failed"
      );

      return {
        success: false,
        error,
        duration,
      };
    }
  }

  /**
   * Execute trigger based on type
   */
  private async executeTrigger(
    trigger: JobTrigger,
    ctx: JobExecutionContext
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    switch (trigger.type) {
      case "agent_ask":
        return this.executeAgentAsk(trigger.prompt, ctx);
      case "tool_call":
        return this.executeToolCall(trigger.tool, trigger.args || {}, ctx);
      case "webhook":
        return this.executeWebhook(trigger, ctx);
      default:
        throw new Error(`Unknown trigger type: ${(trigger as JobTrigger).type}`);
    }
  }

  /**
   * Execute agent_ask trigger
   */
  private async executeAgentAsk(
    prompt: string,
    ctx: JobExecutionContext
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    if (!this.deps.agentExecutor) {
      return {
        success: false,
        error: "Agent executor not configured",
      };
    }

    const result = await this.deps.agentExecutor({
      sessionKey: `cron:${ctx.job.id}`,
      query: prompt,
      cronContext: {
        jobId: ctx.job.id,
        jobName: ctx.job.name,
        schedule: ctx.job.schedule,
        triggeredAt: ctx.triggeredAt,
      },
    });

    return {
      success: !result.error,
      output: result.response,
      error: result.error,
    };
  }

  /**
   * Execute tool_call trigger
   */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    ctx: JobExecutionContext
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    if (!this.deps.toolExecutor) {
      return {
        success: false,
        error: "Tool executor not configured",
      };
    }

    const result = await this.deps.toolExecutor(toolName, args);

    return {
      success: result.ok,
      output: result.data,
      error: result.error,
    };
  }

  /**
   * Execute webhook trigger
   */
  private async executeWebhook(
    trigger: Extract<JobTrigger, { type: "webhook" }>,
    ctx: JobExecutionContext
  ): Promise<{ success: boolean; output?: unknown; error?: string }> {
    try {
      const method = trigger.method || "GET";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "ANT-Scheduler/1.0",
        ...trigger.headers,
      };

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (method !== "GET" && trigger.body) {
        fetchOptions.body =
          typeof trigger.body === "string"
            ? trigger.body
            : JSON.stringify(trigger.body);
      }

      const response = await fetch(trigger.url, fetchOptions);

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get("content-type");
      let output: unknown;

      if (contentType?.includes("application/json")) {
        output = await response.json();
      } else {
        output = await response.text();
      }

      return {
        success: true,
        output,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Process post-execution actions
   */
  private async processActions(
    actions: JobAction[],
    output: unknown,
    ctx: JobExecutionContext
  ): Promise<void> {
    for (const action of actions) {
      try {
        await this.processAction(action, output, ctx);
      } catch (err) {
        this.logger.warn(
          {
            jobId: ctx.job.id,
            actionType: action.type,
            error: err instanceof Error ? err.message : String(err),
          },
          "Action processing failed"
        );
        // Continue with other actions even if one fails
      }
    }
  }

  /**
   * Process a single action
   */
  private async processAction(
    action: JobAction,
    output: unknown,
    ctx: JobExecutionContext
  ): Promise<void> {
    switch (action.type) {
      case "memory_update":
        await this.processMemoryUpdate(action, output, ctx);
        break;
      case "send_message":
        await this.processSendMessage(action, output, ctx);
        break;
      case "log_event":
        this.processLogEvent(action, output, ctx);
        break;
      default:
        this.logger.warn({ actionType: (action as JobAction).type }, "Unknown action type");
    }
  }

  /**
   * Process memory_update action
   */
  private async processMemoryUpdate(
    action: Extract<JobAction, { type: "memory_update" }>,
    output: unknown,
    ctx: JobExecutionContext
  ): Promise<void> {
    if (!this.deps.memoryUpdater) {
      this.logger.debug("Memory updater not configured, skipping memory_update action");
      return;
    }

    const key = action.key || `cron:${ctx.job.id}:${ctx.triggeredAt}`;
    const content =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);

    await this.deps.memoryUpdater({
      key,
      content,
      tags: action.tags,
    });
  }

  /**
   * Process send_message action
   */
  private async processSendMessage(
    action: Extract<JobAction, { type: "send_message" }>,
    output: unknown,
    ctx: JobExecutionContext
  ): Promise<void> {
    if (!this.deps.messageSender) {
      this.logger.debug("Message sender not configured, skipping send_message action");
      return;
    }

    const content =
      typeof output === "string" ? output : JSON.stringify(output, null, 2);

    await this.deps.messageSender({
      channel: action.channel,
      recipient: action.recipient,
      content,
    });
  }

  /**
   * Process log_event action
   */
  private processLogEvent(
    action: Extract<JobAction, { type: "log_event" }>,
    output: unknown,
    ctx: JobExecutionContext
  ): void {
    const level = action.level || "info";
    const prefix = action.prefix || `[Cron:${ctx.job.id}]`;
    const message = `${prefix} ${typeof output === "string" ? output : JSON.stringify(output)}`;

    switch (level) {
      case "warn":
        this.logger.warn({ jobId: ctx.job.id }, message);
        break;
      case "error":
        this.logger.error({ jobId: ctx.job.id }, message);
        break;
      default:
        this.logger.info({ jobId: ctx.job.id }, message);
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Job execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Calculate delay for exponential backoff
   */
  static calculateBackoffDelay(retryCount: number, baseDelayMs = 1000): number {
    // Exponential backoff with jitter: delay = base * 2^retry + random jitter
    const exponentialDelay = baseDelayMs * Math.pow(2, retryCount);
    const jitter = Math.random() * 1000;
    return Math.min(exponentialDelay + jitter, 300000); // Cap at 5 minutes
  }
}

/**
 * Cron Scheduler - Main scheduling engine for ANT CLI
 *
 * Features:
 * - Cron expression support via node-cron
 * - Persistent job storage in .ant/jobs.json
 * - Retry with exponential backoff
 * - Job lifecycle management (add, remove, enable, disable)
 * - Event emission for monitoring
 */

import cron from "node-cron";

import { JobStore } from "./job-store.js";
import { JobExecutor, type ExecutorDependencies } from "./job-executor.js";
import type {
  ScheduledJob,
  JobResult,
  SchedulerConfig,
  RunningJob,
  SchedulerEvent,
  SchedulerEventHandler,
  JobTrigger,
  JobAction,
} from "./types.js";
import type { Logger } from "../log.js";

/**
 * Cron Scheduler - manages scheduled job execution
 */
export class Scheduler {
  private readonly store: JobStore;
  private readonly executor: JobExecutor;
  private readonly logger: Logger;
  private readonly runningJobs: Map<string, RunningJob> = new Map();
  private readonly eventHandlers: Set<SchedulerEventHandler> = new Set();
  private started = false;

  constructor(config: SchedulerConfig) {
    this.logger = config.logger.child({ component: "scheduler" });
    this.store = new JobStore(config.stateDir, config.logger);

    const deps: ExecutorDependencies = {
      agentExecutor: config.agentExecutor,
      toolExecutor: config.toolExecutor,
      messageSender: config.messageSender,
      memoryUpdater: config.memoryUpdater,
    };
    this.executor = new JobExecutor(config.logger, deps);
  }

  /**
   * Initialize and start the scheduler
   */
  async start(): Promise<void> {
    if (this.started) {
      this.logger.warn("Scheduler already started");
      return;
    }

    await this.store.load();

    // Schedule all enabled jobs
    const enabledJobs = this.store.getEnabled();
    for (const job of enabledJobs) {
      this.scheduleJob(job);
    }

    this.started = true;
    this.emit({ type: "scheduler_started", timestamp: Date.now() });
    this.logger.info({ jobCount: enabledJobs.length }, "Scheduler started");
  }

  /**
   * Stop the scheduler and all running jobs
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    // Stop all running cron tasks
    for (const [id, running] of this.runningJobs) {
      running.task.stop();
      this.logger.debug({ jobId: id }, "Stopped job");
    }
    this.runningJobs.clear();

    this.started = false;
    this.emit({ type: "scheduler_stopped", timestamp: Date.now() });
    this.logger.info("Scheduler stopped");
  }

  /**
   * Add a new job
   */
  async addJob(params: {
    id: string;
    name: string;
    schedule: string;
    trigger: JobTrigger;
    actions?: JobAction[];
    retryOnFailure?: boolean;
    maxRetries?: number;
    timeout?: number;
    enabled?: boolean;
  }): Promise<ScheduledJob> {
    // Validate cron expression
    if (!cron.validate(params.schedule)) {
      throw new Error(`Invalid cron expression: ${params.schedule}`);
    }

    const job = await this.store.add({
      id: params.id,
      name: params.name,
      enabled: params.enabled !== false,
      schedule: params.schedule,
      trigger: params.trigger,
      actions: params.actions || [],
      retryOnFailure: params.retryOnFailure !== false,
      maxRetries: params.maxRetries ?? 3,
      timeout: params.timeout ?? 300000,
    });

    // Schedule if enabled and scheduler is running
    if (job.enabled && this.started) {
      this.scheduleJob(job);
    }

    this.emit({ type: "job_added", timestamp: Date.now(), jobId: job.id });
    return job;
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    // Stop running task if any
    const running = this.runningJobs.get(id);
    if (running) {
      running.task.stop();
      this.runningJobs.delete(id);
    }

    const removed = await this.store.remove(id);
    if (removed) {
      this.emit({ type: "job_removed", timestamp: Date.now(), jobId: id });
    }
    return removed;
  }

  /**
   * List all jobs
   */
  listJobs(): ScheduledJob[] {
    return this.store.getAll();
  }

  /**
   * Get a specific job
   */
  getJob(id: string): ScheduledJob | undefined {
    return this.store.get(id);
  }

  /**
   * Enable a job
   */
  async enableJob(id: string): Promise<ScheduledJob> {
    const job = await this.store.enable(id);

    // Schedule if not already running
    if (this.started && !this.runningJobs.has(id)) {
      this.scheduleJob(job);
    }

    this.emit({ type: "job_enabled", timestamp: Date.now(), jobId: id });
    return job;
  }

  /**
   * Disable a job
   */
  async disableJob(id: string): Promise<ScheduledJob> {
    const job = await this.store.disable(id);

    // Stop running task
    const running = this.runningJobs.get(id);
    if (running) {
      running.task.stop();
      this.runningJobs.delete(id);
    }

    this.emit({ type: "job_disabled", timestamp: Date.now(), jobId: id });
    return job;
  }

  /**
   * Run a job immediately (outside of schedule)
   */
  async runJob(id: string): Promise<JobResult> {
    const job = this.store.get(id);
    if (!job) {
      throw new Error(`Job with ID '${id}' not found`);
    }

    return this.executeJob(job);
  }

  /**
   * Subscribe to scheduler events
   */
  onEvent(handler: SchedulerEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Check if scheduler is running
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Get count of active jobs
   */
  getActiveJobCount(): number {
    return this.runningJobs.size;
  }

  /**
   * Schedule a job using node-cron
   */
  private scheduleJob(job: ScheduledJob): void {
    if (this.runningJobs.has(job.id)) {
      this.logger.debug({ jobId: job.id }, "Job already scheduled");
      return;
    }

    const task = cron.schedule(
      job.schedule,
      async () => {
        await this.executeJob(job);
      },
      {
        timezone: process.env.TZ || "UTC",
        name: job.id,
      }
    );

    this.runningJobs.set(job.id, { id: job.id, task, job });
    this.logger.debug({ jobId: job.id, schedule: job.schedule }, "Job scheduled");
  }

  /**
   * Execute a job with retry logic
   */
  private async executeJob(job: ScheduledJob): Promise<JobResult> {
    const triggeredAt = Date.now();
    let retryCount = 0;
    let lastError: string | undefined;
    let lastOutput: unknown;

    this.emit({
      type: "job_started",
      timestamp: triggeredAt,
      jobId: job.id,
      data: { name: job.name, schedule: job.schedule },
    });

    // Execute with retries
    while (retryCount <= (job.retryOnFailure ? job.maxRetries : 0)) {
      const result = await this.executor.execute({
        job,
        triggeredAt,
        retryCount,
        logger: this.logger,
      });

      if (result.success) {
        const jobResult: JobResult = {
          status: "success",
          completedAt: Date.now(),
          duration: result.duration,
          output: result.output,
          retryCount,
        };

        await this.store.updateRunResult(job.id, jobResult);

        this.emit({
          type: "job_completed",
          timestamp: Date.now(),
          jobId: job.id,
          data: { duration: result.duration, retryCount },
        });

        return jobResult;
      }

      lastError = result.error;
      lastOutput = result.output;
      retryCount++;

      if (retryCount <= job.maxRetries && job.retryOnFailure) {
        const delay = JobExecutor.calculateBackoffDelay(retryCount - 1);
        this.logger.info(
          { jobId: job.id, retryCount, delay },
          "Scheduling retry after failure"
        );
        await this.sleep(delay);
      }
    }

    // All retries exhausted
    const jobResult: JobResult = {
      status: "failure",
      completedAt: Date.now(),
      duration: Date.now() - triggeredAt,
      error: lastError,
      output: lastOutput,
      retryCount: retryCount - 1,
    };

    await this.store.updateRunResult(job.id, jobResult);

    this.emit({
      type: "job_failed",
      timestamp: Date.now(),
      jobId: job.id,
      data: { error: lastError, retryCount: retryCount - 1 },
    });

    return jobResult;
  }

  /**
   * Emit a scheduler event
   */
  private emit(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Event handler error"
        );
      }
    }
  }

  /**
   * Sleep for a duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validate a cron expression
   */
  static validateCronExpression(expression: string): boolean {
    return cron.validate(expression);
  }

  /**
   * Get next run time for a cron expression
   */
  static getNextRunTime(expression: string): Date | null {
    // node-cron doesn't have a built-in method for this
    // This is a simplified implementation
    try {
      if (!cron.validate(expression)) return null;
      // For now, return null - in production, use a library like cron-parser
      return null;
    } catch {
      return null;
    }
  }
}

export { JobStore } from "./job-store.js";
export { JobExecutor } from "./job-executor.js";
export * from "./types.js";

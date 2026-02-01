/**
 * Job Store - Persistent storage for scheduled jobs
 *
 * Handles loading, saving, and managing jobs in .ant/jobs.json
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { ScheduledJob, JobsFile, JobResult, JobTrigger, JobAction } from "./types.js";
import type { Logger } from "../log.js";

const JOBS_FILE = "jobs.json";
const CURRENT_VERSION = 1;

/**
 * Job Store - manages persistent job storage
 */
export class JobStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private jobs: Map<string, ScheduledJob> = new Map();
  private loaded = false;

  constructor(stateDir: string, logger: Logger) {
    this.filePath = path.join(stateDir, JOBS_FILE);
    this.logger = logger.child({ component: "job-store" });
  }

  /**
   * Load jobs from disk
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, "utf-8");
      const data = JSON.parse(content) as JobsFile;

      // Validate version
      if (data.version !== CURRENT_VERSION) {
        this.logger.warn(
          { fileVersion: data.version, currentVersion: CURRENT_VERSION },
          "Jobs file version mismatch, migrating..."
        );
        // Future: handle migrations here
      }

      // Load jobs into map
      this.jobs.clear();
      for (const job of data.jobs) {
        if (this.validateJob(job)) {
          this.jobs.set(job.id, job);
        } else {
          this.logger.warn({ jobId: job.id }, "Skipping invalid job");
        }
      }

      this.loaded = true;
      this.logger.info({ jobCount: this.jobs.size }, "Jobs loaded from disk");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // File doesn't exist, start with empty jobs
        this.jobs.clear();
        this.loaded = true;
        this.logger.debug("No jobs file found, starting fresh");
      } else {
        this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to load jobs");
        throw err;
      }
    }
  }

  /**
   * Save jobs to disk
   */
  async save(): Promise<void> {
    const data: JobsFile = {
      version: CURRENT_VERSION,
      jobs: Array.from(this.jobs.values()),
    };

    // Ensure directory exists
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    // Write atomically (write to temp file, then rename)
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tempPath, this.filePath);

    this.logger.debug({ jobCount: this.jobs.size }, "Jobs saved to disk");
  }

  /**
   * Get all jobs
   */
  getAll(): ScheduledJob[] {
    this.ensureLoaded();
    return Array.from(this.jobs.values());
  }

  /**
   * Get enabled jobs only
   */
  getEnabled(): ScheduledJob[] {
    return this.getAll().filter((job) => job.enabled);
  }

  /**
   * Get a specific job by ID
   */
  get(id: string): ScheduledJob | undefined {
    this.ensureLoaded();
    return this.jobs.get(id);
  }

  /**
   * Add a new job
   */
  async add(job: Omit<ScheduledJob, "createdAt" | "updatedAt">): Promise<ScheduledJob> {
    this.ensureLoaded();

    if (this.jobs.has(job.id)) {
      throw new Error(`Job with ID '${job.id}' already exists`);
    }

    const now = Date.now();
    const fullJob: ScheduledJob = {
      ...job,
      createdAt: now,
      updatedAt: now,
    };

    if (!this.validateJob(fullJob)) {
      throw new Error("Invalid job configuration");
    }

    this.jobs.set(job.id, fullJob);
    await this.save();

    this.logger.info({ jobId: job.id, name: job.name }, "Job added");
    return fullJob;
  }

  /**
   * Update an existing job
   */
  async update(id: string, updates: Partial<Omit<ScheduledJob, "id" | "createdAt">>): Promise<ScheduledJob> {
    this.ensureLoaded();

    const existing = this.jobs.get(id);
    if (!existing) {
      throw new Error(`Job with ID '${id}' not found`);
    }

    const updatedJob: ScheduledJob = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      createdAt: existing.createdAt, // Prevent createdAt change
      updatedAt: Date.now(),
    };

    if (!this.validateJob(updatedJob)) {
      throw new Error("Invalid job configuration");
    }

    this.jobs.set(id, updatedJob);
    await this.save();

    this.logger.info({ jobId: id }, "Job updated");
    return updatedJob;
  }

  /**
   * Remove a job
   */
  async remove(id: string): Promise<boolean> {
    this.ensureLoaded();

    if (!this.jobs.has(id)) {
      return false;
    }

    this.jobs.delete(id);
    await this.save();

    this.logger.info({ jobId: id }, "Job removed");
    return true;
  }

  /**
   * Enable a job
   */
  async enable(id: string): Promise<ScheduledJob> {
    return this.update(id, { enabled: true });
  }

  /**
   * Disable a job
   */
  async disable(id: string): Promise<ScheduledJob> {
    return this.update(id, { enabled: false });
  }

  /**
   * Update job run result
   */
  async updateRunResult(id: string, result: JobResult): Promise<void> {
    this.ensureLoaded();

    const job = this.jobs.get(id);
    if (!job) {
      this.logger.warn({ jobId: id }, "Cannot update run result: job not found");
      return;
    }

    job.lastRun = result.completedAt;
    job.lastResult = result;
    job.updatedAt = Date.now();

    this.jobs.set(id, job);
    await this.save();
  }

  /**
   * Check if jobs are loaded
   */
  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error("JobStore not loaded. Call load() first.");
    }
  }

  /**
   * Validate a job configuration
   */
  private validateJob(job: ScheduledJob): boolean {
    // Required fields
    if (!job.id || typeof job.id !== "string") return false;
    if (!job.name || typeof job.name !== "string") return false;
    if (typeof job.enabled !== "boolean") return false;
    if (!job.schedule || typeof job.schedule !== "string") return false;

    // Validate trigger
    if (!this.validateTrigger(job.trigger)) return false;

    // Validate actions (can be empty array)
    if (!Array.isArray(job.actions)) return false;
    for (const action of job.actions) {
      if (!this.validateAction(action)) return false;
    }

    // Validate cron expression (basic check)
    if (!this.isValidCronExpression(job.schedule)) return false;

    return true;
  }

  /**
   * Validate trigger configuration
   */
  private validateTrigger(trigger: JobTrigger): boolean {
    if (!trigger || typeof trigger !== "object") return false;

    switch (trigger.type) {
      case "agent_ask":
        return typeof trigger.prompt === "string" && trigger.prompt.length > 0;
      case "tool_call":
        return typeof trigger.tool === "string" && trigger.tool.length > 0;
      case "webhook":
        return typeof trigger.url === "string" && trigger.url.startsWith("http");
      default:
        return false;
    }
  }

  /**
   * Validate action configuration
   */
  private validateAction(action: JobAction): boolean {
    if (!action || typeof action !== "object") return false;

    switch (action.type) {
      case "memory_update":
        return true; // All fields are optional
      case "send_message":
        return typeof action.channel === "string" && typeof action.recipient === "string";
      case "log_event":
        return true; // All fields are optional
      default:
        return false;
    }
  }

  /**
   * Basic cron expression validation
   */
  private isValidCronExpression(expr: string): boolean {
    // Basic validation: 5 or 6 fields separated by spaces
    const parts = expr.trim().split(/\s+/);
    return parts.length >= 5 && parts.length <= 6;
  }

  /**
   * Create a default job template
   */
  static createJobTemplate(params: {
    id: string;
    name: string;
    schedule: string;
    trigger: JobTrigger;
    actions?: JobAction[];
  }): Omit<ScheduledJob, "createdAt" | "updatedAt"> {
    return {
      id: params.id,
      name: params.name,
      enabled: true,
      schedule: params.schedule,
      trigger: params.trigger,
      actions: params.actions || [],
      retryOnFailure: true,
      maxRetries: 3,
      timeout: 300000, // 5 minutes default
    };
  }
}

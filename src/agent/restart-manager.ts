/**
 * Restart Manager - Graceful restart mechanism for self-improvement
 *
 * Features:
 * - Set restart flag in .ant/restart.json
 * - Store current task context for resume
 * - Trigger graceful shutdown
 * - On restart, check for interrupted tasks and resume
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../log.js";

/**
 * Restart reason types
 */
export type RestartReason =
  | "skill_update"
  | "source_update"
  | "config_change"
  | "user_request"
  | "error_recovery"
  | "scheduled";

/**
 * Task context to preserve across restarts
 */
export interface TaskContext {
  id: string;
  type: string;
  query?: string;
  sessionKey?: string;
  chatId?: string;
  channel?: string;
  startedAt: number;
  state: Record<string, unknown>;
  toolsExecuted: string[];
  partialResponse?: string;
}

/**
 * Restart state persisted to disk
 */
export interface RestartState {
  requested: boolean;
  requestedAt: number;
  reason: RestartReason;
  message?: string;
  taskContext?: TaskContext;
  metadata?: Record<string, unknown>;
}

/**
 * Restart result
 */
export interface RestartResult {
  hadInterruptedTask: boolean;
  taskContext?: TaskContext;
  restartState?: RestartState;
}

/**
 * Shutdown handler function type
 */
export type ShutdownHandler = (reason: RestartReason) => Promise<void>;

/**
 * Restart Manager class
 */
export class RestartManager {
  private readonly logger: Logger;
  private readonly stateDir: string;
  private readonly restartFile: string;
  private shutdownHandlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  constructor(params: {
    logger: Logger;
    stateDir: string;
  }) {
    this.logger = params.logger;
    this.stateDir = params.stateDir;
    this.restartFile = path.join(params.stateDir, "restart.json");
  }

  /**
   * Initialize the restart manager
   */
  async initialize(): Promise<RestartResult> {
    // Ensure state directory exists
    await fs.mkdir(this.stateDir, { recursive: true });

    // Check for interrupted task from previous restart
    const restartState = await this.loadRestartState();

    if (restartState?.requested) {
      this.logger.info(
        {
          reason: restartState.reason,
          hasTask: !!restartState.taskContext,
        },
        "Resuming from restart"
      );

      // Clear the restart flag
      await this.clearRestartState();

      return {
        hadInterruptedTask: !!restartState.taskContext,
        taskContext: restartState.taskContext,
        restartState,
      };
    }

    return { hadInterruptedTask: false };
  }

  /**
   * Request a graceful restart
   */
  async requestRestart(params: {
    reason: RestartReason;
    message?: string;
    taskContext?: TaskContext;
    metadata?: Record<string, unknown>;
    immediate?: boolean;
  }): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn("Restart already in progress");
      return;
    }

    this.isShuttingDown = true;
    this.logger.info({ reason: params.reason, message: params.message }, "Restart requested");

    // Save restart state
    const state: RestartState = {
      requested: true,
      requestedAt: Date.now(),
      reason: params.reason,
      message: params.message,
      taskContext: params.taskContext,
      metadata: params.metadata,
    };

    await this.saveRestartState(state);

    // Run shutdown handlers
    for (const handler of this.shutdownHandlers) {
      try {
        await handler(params.reason);
      } catch (err) {
        this.logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          "Shutdown handler error"
        );
      }
    }

    // Trigger actual restart
    if (params.immediate) {
      await this.triggerRestart();
    } else {
      // Schedule restart after a brief delay
      setTimeout(() => {
        void this.triggerRestart().catch((err) => {
          this.logger.warn(
            { error: err instanceof Error ? err.message : String(err) },
            "Restart trigger failed"
          );
        });
      }, 100);
    }
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: ShutdownHandler): void {
    this.shutdownHandlers.push(handler);
  }

  /**
   * Save current task context for potential resume
   */
  async saveTaskContext(context: TaskContext): Promise<void> {
    const state = await this.loadRestartState();
    const newState: RestartState = {
      ...state,
      requested: state?.requested || false,
      requestedAt: state?.requestedAt || Date.now(),
      reason: state?.reason || "error_recovery",
      taskContext: context,
    };
    await this.saveRestartState(newState);
    this.logger.debug({ taskId: context.id }, "Task context saved");
  }

  /**
   * Clear saved task context
   */
  async clearTaskContext(): Promise<void> {
    const state = await this.loadRestartState();
    if (state?.taskContext) {
      delete state.taskContext;
      await this.saveRestartState(state);
      this.logger.debug("Task context cleared");
    }
  }

  /**
   * Check if a restart is pending
   */
  async isRestartPending(): Promise<boolean> {
    const state = await this.loadRestartState();
    return state?.requested || false;
  }

  /**
   * Get pending restart info
   */
  async getPendingRestart(): Promise<RestartState | null> {
    const state = await this.loadRestartState();
    return state?.requested ? state : null;
  }

  /**
   * Cancel a pending restart
   */
  async cancelRestart(): Promise<boolean> {
    if (this.isShuttingDown) {
      this.logger.warn("Cannot cancel restart - shutdown in progress");
      return false;
    }

    const state = await this.loadRestartState();
    if (state?.requested) {
      await this.clearRestartState();
      this.logger.info("Restart cancelled");
      return true;
    }

    return false;
  }

  /**
   * Create a task context from current execution
   */
  createTaskContext(params: {
    type: string;
    query?: string;
    sessionKey?: string;
    chatId?: string;
    channel?: string;
    state?: Record<string, unknown>;
    toolsExecuted?: string[];
    partialResponse?: string;
  }): TaskContext {
    return {
      id: this.generateTaskId(),
      type: params.type,
      query: params.query,
      sessionKey: params.sessionKey,
      chatId: params.chatId,
      channel: params.channel,
      startedAt: Date.now(),
      state: params.state || {},
      toolsExecuted: params.toolsExecuted || [],
      partialResponse: params.partialResponse,
    };
  }

  /**
   * Load restart state from disk
   */
  private async loadRestartState(): Promise<RestartState | null> {
    try {
      const content = await fs.readFile(this.restartFile, "utf-8");
      return JSON.parse(content) as RestartState;
    } catch {
      return null;
    }
  }

  /**
   * Save restart state to disk
   */
  private async saveRestartState(state: RestartState): Promise<void> {
    await fs.writeFile(this.restartFile, JSON.stringify(state, null, 2), "utf-8");
  }

  /**
   * Clear restart state
   */
  private async clearRestartState(): Promise<void> {
    try {
      await fs.unlink(this.restartFile);
    } catch {
      // File doesn't exist, that's ok
    }
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `task-${timestamp}-${random}`;
  }

  /**
   * Trigger the actual restart
   */
  private async triggerRestart(): Promise<void> {
    this.logger.info("Triggering restart...");

    // In a real implementation, this would:
    // 1. Signal the parent process to restart
    // 2. Or use PM2/systemd restart
    // 3. Or exec() a new process

    // For now, we exit with a specific code that the parent can detect
    // Code 42 is a convention for "restart requested"
    process.exit(42);
  }

  /**
   * Check if we're in shutdown state
   */
  get shuttingDown(): boolean {
    return this.isShuttingDown;
  }
}

/**
 * Restart manager singleton
 */
let restartManagerInstance: RestartManager | null = null;

/**
 * Create or get the restart manager instance
 */
export function createRestartManager(params: {
  logger: Logger;
  stateDir: string;
}): RestartManager {
  if (!restartManagerInstance) {
    restartManagerInstance = new RestartManager(params);
  }
  return restartManagerInstance;
}

/**
 * Get the current restart manager instance
 */
export function getRestartManager(): RestartManager | null {
  return restartManagerInstance;
}

/**
 * Wrapper script for restart detection
 *
 * This can be used as the entry point to automatically restart on exit code 42:
 *
 * ```bash
 * #!/bin/bash
 * while true; do
 *   node dist/cli.js "$@"
 *   EXIT_CODE=$?
 *   if [ $EXIT_CODE -ne 42 ]; then
 *     exit $EXIT_CODE
 *   fi
 *   echo "Restarting..."
 *   sleep 1
 * done
 * ```
 */
export const RESTART_EXIT_CODE = 42;

/**
 * Check if an exit code indicates a restart request
 */
export function isRestartExitCode(code: number): boolean {
  return code === RESTART_EXIT_CODE;
}

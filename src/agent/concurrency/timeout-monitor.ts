import type { Logger } from "../../log.js";
import type { TaskEntry } from "../task/types.js";
import { TaskStore } from "../task/task-store.js";

export class TimeoutMonitor {
  private readonly logger: Logger;
  private readonly taskStore: TaskStore;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly onTimeout: (task: TaskEntry, reason: string) => Promise<void>;
  private readonly onWarning: (task: TaskEntry, msUntilTimeout: number) => Promise<void>;

  constructor(params: {
    logger: Logger;
    taskStore: TaskStore;
    intervalMs: number;
    onTimeout: (task: TaskEntry, reason: string) => Promise<void>;
    onWarning: (task: TaskEntry, msUntilTimeout: number) => Promise<void>;
  }) {
    this.logger = params.logger.child({ component: "timeout-monitor" });
    this.taskStore = params.taskStore;
    this.intervalMs = params.intervalMs;
    this.onTimeout = params.onTimeout;
    this.onWarning = params.onWarning;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((err) => {
        this.logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Timeout monitor failed");
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async check(): Promise<void> {
    const tasks = await this.taskStore.getActiveTasks();
    const now = Date.now();

    for (const task of tasks) {
      if (!task.timeout) continue;
      const msUntilTimeout = task.timeout.willExpireAt - now;
      if (msUntilTimeout <= 10_000 && msUntilTimeout > 0) {
        await this.onWarning(task, msUntilTimeout);
      }
      if (msUntilTimeout <= 0) {
        await this.onTimeout(task, "timeout");
      }
    }
  }
}

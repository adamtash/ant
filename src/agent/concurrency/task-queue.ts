import type { Logger } from "../../log.js";
import type { TaskEntry, TaskResult } from "../task/types.js";
import { TaskLane } from "./lanes.js";

interface QueueItem {
  task: TaskEntry;
  lane: TaskLane;
  run: () => Promise<TaskResult>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export class TaskQueue {
  private readonly logger: Logger;
  private readonly lanes = new Map<TaskLane, { maxConcurrent: number; queue: QueueItem[]; active: number }>();
  private readonly completions = new Map<string, Deferred<TaskResult>>();

  constructor(params: { logger: Logger; laneLimits: Record<TaskLane, number> }) {
    this.logger = params.logger.child({ component: "task-queue" });

    for (const lane of Object.values(TaskLane)) {
      this.lanes.set(lane, {
        maxConcurrent: params.laneLimits[lane],
        queue: [],
        active: 0,
      });
    }
  }

  enqueue(task: TaskEntry, lane: TaskLane, run: () => Promise<TaskResult>): void {
    const laneState = this.lanes.get(lane);
    if (!laneState) {
      throw new Error(`Unknown lane: ${lane}`);
    }

    laneState.queue.push({ task, lane, run });
    this.dispatch(lane);
  }

  enqueueWithDelay(task: TaskEntry, lane: TaskLane, run: () => Promise<TaskResult>, delayMs: number): void {
    setTimeout(() => this.enqueue(task, lane, run), delayMs);
  }

  waitForCompletion(taskId: string, timeoutMs?: number): Promise<TaskResult> {
    const existing = this.completions.get(taskId);
    if (existing) return existing.promise;

    let resolve: (value: TaskResult) => void = () => {};
    let reject: (error: Error) => void = () => {};
    const promise = new Promise<TaskResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const deferred: Deferred<TaskResult> = { promise, resolve, reject };
    this.completions.set(taskId, deferred);

    if (timeoutMs && timeoutMs > 0) {
      setTimeout(() => {
        if (this.completions.get(taskId) === deferred) {
          this.completions.delete(taskId);
          reject(new Error(`Timed out waiting for task ${taskId}`));
        }
      }, timeoutMs);
    }

    return promise;
  }

  getQueueDepth(lane: TaskLane): number {
    return this.lanes.get(lane)?.queue.length ?? 0;
  }

  private dispatch(lane: TaskLane): void {
    const laneState = this.lanes.get(lane);
    if (!laneState) return;

    while (laneState.active < laneState.maxConcurrent && laneState.queue.length > 0) {
      const item = laneState.queue.shift();
      if (!item) break;
      laneState.active += 1;

      this.runItem(item)
        .catch(() => {
          // Errors are handled in runItem
        })
        .finally(() => {
          laneState.active -= 1;
          this.dispatch(lane);
        });
    }
  }

  private async runItem(item: QueueItem): Promise<void> {
    try {
      const result = await item.run();
      this.complete(item.task.taskId, result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.fail(item.task.taskId, error);
    }
  }

  private complete(taskId: string, result: TaskResult): void {
    const deferred = this.completions.get(taskId);
    if (deferred) {
      deferred.resolve(result);
      this.completions.delete(taskId);
    }
  }

  private fail(taskId: string, error: Error): void {
    this.logger.warn({ taskId, error: error.message }, "Task failed in queue");
    const deferred = this.completions.get(taskId);
    if (deferred) {
      deferred.reject(error);
      this.completions.delete(taskId);
    }
  }
}

import type { Logger } from "../log.js";

type QueueEntry<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  enqueuedAt: number;
  warnAfterMs: number;
};

type LaneState = {
  lane: string;
  queue: Array<QueueEntry<unknown>>;
  active: number;
  maxConcurrent: number;
  draining: boolean;
};

export type QueueLaneSnapshot = {
  lane: string;
  queued: number;
  active: number;
  maxConcurrent: number;
  oldestEnqueuedAt?: number;
};

export class CommandQueue {
  private readonly lanes = new Map<string, LaneState>();
  private readonly logger: Logger;
  private readonly warnAfterMs: number;

  constructor(logger: Logger, warnAfterMs: number) {
    this.logger = logger;
    this.warnAfterMs = warnAfterMs;
  }

  private getLane(lane: string): LaneState {
    const key = lane.trim() || "main";
    const existing = this.lanes.get(key);
    if (existing) return existing;
    const created: LaneState = {
      lane: key,
      queue: [],
      active: 0,
      maxConcurrent: 1,
      draining: false,
    };
    this.lanes.set(key, created);
    return created;
  }

  setConcurrency(lane: string, maxConcurrent: number) {
    const state = this.getLane(lane);
    state.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.drainLane(state);
  }

  enqueue<T>(lane: string, task: () => Promise<T>): Promise<T> {
    const state = this.getLane(lane);
    const warnAfterMs = this.warnAfterMs;
    return new Promise<T>((resolve, reject) => {
      state.queue.push({
        task: () => task(),
        resolve: resolve as (value: unknown) => void,
        reject,
        enqueuedAt: Date.now(),
        warnAfterMs,
      });
      this.drainLane(state);
    });
  }

  getQueueSize(lane: string): number {
    const state = this.lanes.get(lane);
    if (!state) return 0;
    return state.queue.length + state.active;
  }

  getTotalQueueSize(): number {
    let total = 0;
    for (const state of this.lanes.values()) {
      total += state.queue.length + state.active;
    }
    return total;
  }

  snapshot(): QueueLaneSnapshot[] {
    const lanes: QueueLaneSnapshot[] = [];
    for (const state of this.lanes.values()) {
      const oldest = state.queue.reduce<number | undefined>((acc, entry) => {
        if (acc === undefined) return entry.enqueuedAt;
        return Math.min(acc, entry.enqueuedAt);
      }, undefined);
      lanes.push({
        lane: state.lane,
        queued: state.queue.length,
        active: state.active,
        maxConcurrent: state.maxConcurrent,
        oldestEnqueuedAt: oldest,
      });
    }
    return lanes.sort((a, b) => a.lane.localeCompare(b.lane));
  }

  private drainLane(state: LaneState) {
    if (state.draining) return;
    state.draining = true;

    const pump = () => {
      while (state.active < state.maxConcurrent && state.queue.length > 0) {
        const entry = state.queue.shift() as QueueEntry<unknown>;
        const waitedMs = Date.now() - entry.enqueuedAt;
        if (waitedMs >= entry.warnAfterMs) {
          this.logger.warn({ lane: state.lane, waitedMs }, "queue wait exceeded");
        }
        state.active += 1;
        void (async () => {
          const start = Date.now();
          try {
            const result = await entry.task();
            state.active -= 1;
            this.logger.debug(
              { lane: state.lane, durationMs: Date.now() - start },
              "queue task completed",
            );
            pump();
            entry.resolve(result as never);
          } catch (err) {
            state.active -= 1;
            this.logger.error(
              { lane: state.lane, durationMs: Date.now() - start, error: String(err) },
              "queue task failed",
            );
            pump();
            entry.reject(err);
          }
        })();
      }
      state.draining = false;
    };

    pump();
  }
}

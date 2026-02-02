export type ActiveRunHandle = {
  runId: string;
  sessionKey: string;
  agentType: "agent" | "subagent";
  startedAt: number;
  metadata?: Record<string, unknown>;
};

type RunWaiter = {
  resolve: (ended: boolean) => void;
  timer: NodeJS.Timeout;
};

const ACTIVE_RUNS = new Map<string, ActiveRunHandle>();
const ACTIVE_RUNS_BY_SESSION = new Map<string, Set<string>>();
const RUN_WAITERS = new Map<string, Set<RunWaiter>>();

export function registerActiveRun(handle: ActiveRunHandle): void {
  if (!handle.runId) return;
  ACTIVE_RUNS.set(handle.runId, handle);
  if (handle.sessionKey) {
    const set = ACTIVE_RUNS_BY_SESSION.get(handle.sessionKey) ?? new Set();
    set.add(handle.runId);
    ACTIVE_RUNS_BY_SESSION.set(handle.sessionKey, set);
  }
}

export function clearActiveRun(runId: string): void {
  const handle = ACTIVE_RUNS.get(runId);
  if (!handle) return;
  ACTIVE_RUNS.delete(runId);
  if (handle.sessionKey) {
    const set = ACTIVE_RUNS_BY_SESSION.get(handle.sessionKey);
    if (set) {
      set.delete(runId);
      if (set.size === 0) {
        ACTIVE_RUNS_BY_SESSION.delete(handle.sessionKey);
      }
    }
  }
  notifyRunEnded(runId);
}

export function isRunActive(runId: string): boolean {
  return ACTIVE_RUNS.has(runId);
}

export function listActiveRuns(): ActiveRunHandle[] {
  return Array.from(ACTIVE_RUNS.values());
}

export function getActiveRunsForSession(sessionKey: string): ActiveRunHandle[] {
  const runIds = ACTIVE_RUNS_BY_SESSION.get(sessionKey);
  if (!runIds) return [];
  return Array.from(runIds)
    .map((runId) => ACTIVE_RUNS.get(runId))
    .filter((run): run is ActiveRunHandle => Boolean(run));
}

export function waitForRunEnd(runId: string, timeoutMs = 15_000): Promise<boolean> {
  if (!runId || !ACTIVE_RUNS.has(runId)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const waiters = RUN_WAITERS.get(runId) ?? new Set<RunWaiter>();
    const waiter: RunWaiter = {
      resolve,
      timer: setTimeout(
        () => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            RUN_WAITERS.delete(runId);
          }
          resolve(false);
        },
        Math.max(100, timeoutMs)
      ),
    };
    waiters.add(waiter);
    RUN_WAITERS.set(runId, waiters);
    if (!ACTIVE_RUNS.has(runId)) {
      waiters.delete(waiter);
      if (waiters.size === 0) {
        RUN_WAITERS.delete(runId);
      }
      clearTimeout(waiter.timer);
      resolve(true);
    }
  });
}

function notifyRunEnded(runId: string): void {
  const waiters = RUN_WAITERS.get(runId);
  if (!waiters || waiters.size === 0) return;
  RUN_WAITERS.delete(runId);
  for (const waiter of waiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(true);
  }
}

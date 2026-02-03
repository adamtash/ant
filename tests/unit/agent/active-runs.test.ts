import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  registerActiveRun,
  clearActiveRun,
  isRunActive,
  listActiveRuns,
  getActiveRunsForSession,
  waitForRunEnd,
  resetActiveRunsForTest,
} from "../../../src/agent/active-runs.js";

describe("active-runs", () => {
  beforeEach(() => {
    resetActiveRunsForTest();
  });

  afterEach(() => {
    resetActiveRunsForTest();
    vi.useRealTimers();
  });

  it("tracks runs by runId and sessionKey", () => {
    registerActiveRun({
      runId: "run-1",
      sessionKey: "session-1",
      agentType: "agent",
      startedAt: Date.now(),
    });

    expect(isRunActive("run-1")).toBe(true);
    expect(listActiveRuns().map((r) => r.runId)).toContain("run-1");

    const bySession = getActiveRunsForSession("session-1");
    expect(bySession.length).toBe(1);
    expect(bySession[0].runId).toBe("run-1");

    clearActiveRun("run-1");
    expect(isRunActive("run-1")).toBe(false);
    expect(getActiveRunsForSession("session-1").length).toBe(0);
  });

  it("waitForRunEnd resolves true when run ends", async () => {
    vi.useFakeTimers();

    registerActiveRun({
      runId: "run-wait",
      sessionKey: "session-wait",
      agentType: "agent",
      startedAt: Date.now(),
    });

    const promise = waitForRunEnd("run-wait", 5000);

    // End the run shortly after
    clearActiveRun("run-wait");
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(true);
  });

  it("waitForRunEnd resolves false on timeout", async () => {
    vi.useFakeTimers();

    registerActiveRun({
      runId: "run-timeout",
      sessionKey: "session-timeout",
      agentType: "agent",
      startedAt: Date.now(),
    });

    const promise = waitForRunEnd("run-timeout", 200);
    await vi.advanceTimersByTimeAsync(250);

    await expect(promise).resolves.toBe(false);
    // cleanup
    clearActiveRun("run-timeout");
  });
});


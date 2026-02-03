import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { JobExecutor } from "../../../src/scheduler/job-executor.js";
import type { ScheduledJob } from "../../../src/scheduler/types.js";

function createMockLogger() {
  const logger: any = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => logger),
  };
  return logger;
}

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  const now = Date.now();
  return {
    id: "job:test",
    name: "Test Job",
    enabled: true,
    schedule: "* * * * *",
    trigger: { type: "agent_ask", prompt: "Hello" },
    actions: [],
    retryOnFailure: true,
    maxRetries: 2,
    timeout: 50,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as any;
}

describe("JobExecutor", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a clear error when agentExecutor is missing", async () => {
    const executor = new JobExecutor(logger as any, {});
    const job = makeJob({ trigger: { type: "agent_ask", prompt: "Hi" } });

    const result = await executor.execute({
      job,
      triggeredAt: Date.now(),
      retryCount: 0,
      logger: logger as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent executor not configured");
    expect(result.duration).toBeTypeOf("number");
  });

  it("executes agent_ask trigger when configured", async () => {
    const agentExecutor = vi.fn(async () => ({ response: "PONG" }));
    const executor = new JobExecutor(logger as any, { agentExecutor });
    const job = makeJob({ trigger: { type: "agent_ask", prompt: "Reply PONG" } });

    const result = await executor.execute({
      job,
      triggeredAt: 123,
      retryCount: 1,
      logger: logger as any,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe("PONG");
    expect(agentExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: `cron:${job.id}` })
    );
  });

  it("executes tool_call trigger and propagates tool errors", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: false, error: "nope" }));
    const executor = new JobExecutor(logger as any, { toolExecutor });
    const job = makeJob({ trigger: { type: "tool_call", tool: "noop", args: { a: 1 } } });

    const result = await executor.execute({
      job,
      triggeredAt: Date.now(),
      retryCount: 0,
      logger: logger as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("nope");
    expect(toolExecutor).toHaveBeenCalledWith("noop", { a: 1 });
  });

  it("executes webhook trigger and parses JSON output", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as any);

    const executor = new JobExecutor(logger as any, {});
    const job = makeJob({
      trigger: { type: "webhook", url: "https://example.test/webhook", method: "POST", body: { a: 1 } },
    });

    const result = await executor.execute({
      job,
      triggeredAt: Date.now(),
      retryCount: 0,
      logger: logger as any,
    });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/webhook",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("continues processing actions even if one fails", async () => {
    const toolExecutor = vi.fn(async () => ({ ok: true, data: "RESULT" }));
    const messageSender = vi.fn(async () => {
      throw new Error("send failed");
    });
    const memoryUpdater = vi.fn(async () => {});

    const executor = new JobExecutor(logger as any, { toolExecutor, messageSender, memoryUpdater });
    const job = makeJob({
      trigger: { type: "tool_call", tool: "noop" },
      actions: [
        { type: "send_message", channel: "cli", recipient: "someone" },
        { type: "memory_update", key: "key-1", tags: ["t"] },
      ],
    });

    const result = await executor.execute({
      job,
      triggeredAt: 456,
      retryCount: 0,
      logger: logger as any,
    });

    expect(result.success).toBe(true);
    expect(messageSender).toHaveBeenCalled();
    expect(memoryUpdater).toHaveBeenCalledWith(
      expect.objectContaining({ key: "key-1", content: "RESULT", tags: ["t"] })
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.any(Object), "Action processing failed");
  });

  it("times out long-running triggers", async () => {
    const agentExecutor = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { response: "late" };
    });
    const executor = new JobExecutor(logger as any, { agentExecutor });
    const job = makeJob({ timeout: 5, trigger: { type: "agent_ask", prompt: "slow" } });

    const result = await executor.execute({
      job,
      triggeredAt: Date.now(),
      retryCount: 0,
      logger: logger as any,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("calculateBackoffDelay() uses exponential backoff with jitter and caps", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(JobExecutor.calculateBackoffDelay(0, 1000)).toBe(1000);
    expect(JobExecutor.calculateBackoffDelay(1, 1000)).toBe(2000);
    randomSpy.mockRestore();

    vi.spyOn(Math, "random").mockReturnValue(1);
    // 2^10 * 1000 + 1000 = 1_025_000, but capped at 300_000
    expect(JobExecutor.calculateBackoffDelay(10, 1000)).toBe(300000);
  });
});


import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { JobStore } from "../../../src/scheduler/job-store.js";

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

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("JobStore", () => {
  let stateDir: string;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    stateDir = await makeTempDir("ant-jobs-");
    logger = createMockLogger();
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("requires load() before accessing jobs", () => {
    const store = new JobStore(stateDir, logger as any);
    expect(() => store.getAll()).toThrow("JobStore not loaded");
  });

  it("load() starts fresh when jobs.json is missing", async () => {
    const store = new JobStore(stateDir, logger as any);
    await store.load();
    expect(store.getAll()).toEqual([]);
  });

  it("add() persists jobs and load() restores them", async () => {
    const store = new JobStore(stateDir, logger as any);
    await store.load();

    const template = JobStore.createJobTemplate({
      id: "job-1",
      name: "Job 1",
      schedule: "0 * * * *",
      trigger: { type: "agent_ask", prompt: "Hello" },
    });

    const created = await store.add(template);
    expect(created.id).toBe("job-1");
    expect(created.createdAt).toBeTypeOf("number");
    expect(created.updatedAt).toBeTypeOf("number");

    const store2 = new JobStore(stateDir, logger as any);
    await store2.load();

    const loaded = store2.get("job-1");
    expect(loaded?.name).toBe("Job 1");
    expect(loaded?.trigger.type).toBe("agent_ask");
  });

  it("load() warns on version mismatch and skips invalid jobs", async () => {
    const filePath = path.join(stateDir, "jobs.json");
    const now = Date.now();
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          version: 999,
          jobs: [
            {
              id: "valid",
              name: "Valid",
              enabled: true,
              schedule: "0 * * * *",
              trigger: { type: "agent_ask", prompt: "Hi" },
              actions: [],
              retryOnFailure: true,
              maxRetries: 3,
              timeout: 10_000,
              createdAt: now,
              updatedAt: now,
            },
            // Invalid: bad schedule format
            {
              id: "invalid",
              name: "Invalid",
              enabled: true,
              schedule: "invalid",
              trigger: { type: "agent_ask", prompt: "Hi" },
              actions: [],
              retryOnFailure: true,
              maxRetries: 3,
              timeout: 10_000,
              createdAt: now,
              updatedAt: now,
            },
          ],
        },
        null,
        2
      ),
      "utf-8"
    );

    const store = new JobStore(stateDir, logger as any);
    await store.load();

    expect(store.get("valid")).toBeTruthy();
    expect(store.get("invalid")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("update() preserves id/createdAt and rejects invalid updates", async () => {
    const store = new JobStore(stateDir, logger as any);
    await store.load();

    const created = await store.add(
      JobStore.createJobTemplate({
        id: "job-2",
        name: "Job 2",
        schedule: "0 * * * *",
        trigger: { type: "tool_call", tool: "noop" },
      })
    );

    const updated = await store.update("job-2", { enabled: false });
    expect(updated.id).toBe("job-2");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
    expect(updated.enabled).toBe(false);

    await expect(store.update("job-2", { schedule: "invalid" })).rejects.toThrow(
      "Invalid job configuration"
    );
  });

  it("remove() returns false when missing and true when removed", async () => {
    const store = new JobStore(stateDir, logger as any);
    await store.load();

    expect(await store.remove("missing")).toBe(false);

    await store.add(
      JobStore.createJobTemplate({
        id: "job-3",
        name: "Job 3",
        schedule: "0 * * * *",
        trigger: { type: "agent_ask", prompt: "Hello" },
      })
    );

    expect(await store.remove("job-3")).toBe(true);
    expect(store.get("job-3")).toBeUndefined();
  });

  it("updateRunResult() stores last result metadata", async () => {
    const store = new JobStore(stateDir, logger as any);
    await store.load();

    await store.add(
      JobStore.createJobTemplate({
        id: "job-4",
        name: "Job 4",
        schedule: "0 * * * *",
        trigger: { type: "agent_ask", prompt: "Hello" },
      })
    );

    const completedAt = Date.now();
    await store.updateRunResult("job-4", {
      status: "success",
      completedAt,
      duration: 12,
      output: { ok: true },
    });

    const job = store.get("job-4");
    expect(job?.lastRun).toBe(completedAt);
    expect(job?.lastResult?.status).toBe("success");
    expect(job?.lastResult?.output).toEqual({ ok: true });
  });
});


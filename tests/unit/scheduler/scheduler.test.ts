import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../../../src/scheduler/scheduler.js";
import type { SchedulerConfig, SchedulerEvent } from "../../../src/scheduler/types.js";

// Mock node-cron
vi.mock("node-cron", () => ({
  default: {
    validate: vi.fn((expr: string) => {
      // Basic validation - accept standard cron expressions
      const parts = expr.split(" ");
      return parts.length >= 5 && parts.length <= 6;
    }),
    schedule: vi.fn((schedule: string, callback: () => void, options?: any) => {
      return {
        start: vi.fn(),
        stop: vi.fn(),
      };
    }),
  },
}));

// Mock JobStore
vi.mock("../../../src/scheduler/job-store.js", () => ({
  JobStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    getEnabled: vi.fn().mockReturnValue([]),
    getAll: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    add: vi.fn().mockImplementation((job) => Promise.resolve({ ...job, createdAt: Date.now(), updatedAt: Date.now() })),
    remove: vi.fn().mockResolvedValue(true),
    enable: vi.fn().mockImplementation((id) => Promise.resolve({ id, enabled: true })),
    disable: vi.fn().mockImplementation((id) => Promise.resolve({ id, enabled: false })),
    updateRunResult: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock logger - return the same child logger instance so we can assert on it
let childLogger: ReturnType<typeof createMockLogger>;
const createMockLogger = (): any => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => {
      if (!childLogger) {
        childLogger = createMockLogger();
      }
      return childLogger;
    }),
  };
  return logger;
};

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let mockLogger: ReturnType<typeof createMockLogger>;

  const createSchedulerConfig = (): SchedulerConfig => ({
    stateDir: "/tmp/test-state",
    logger: mockLogger as any,
    agentExecutor: vi.fn(),
    toolExecutor: vi.fn(),
    messageSender: vi.fn(),
    memoryUpdater: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    childLogger = undefined as any; // Reset child logger
    mockLogger = createMockLogger();
    scheduler = new Scheduler(createSchedulerConfig());
  });

  afterEach(async () => {
    if (scheduler.isRunning()) {
      await scheduler.stop();
    }
  });

  describe("lifecycle", () => {
    it("should start and stop correctly", async () => {
      expect(scheduler.isRunning()).toBe(false);

      await scheduler.start();
      expect(scheduler.isRunning()).toBe(true);

      await scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
    });

    it("should warn when starting already started scheduler", async () => {
      await scheduler.start();
      await scheduler.start(); // Second start

      // The child logger is stored internally and used for warnings
      expect(childLogger.warn).toHaveBeenCalledWith("Scheduler already started");
    });

    it("should not error when stopping already stopped scheduler", async () => {
      await scheduler.stop(); // Should not throw
      expect(scheduler.isRunning()).toBe(false);
    });
  });

  describe("job management", () => {
    it("should add a job with valid cron expression", async () => {
      await scheduler.start();

      const job = await scheduler.addJob({
        id: "test-job-1",
        name: "Test Job",
        schedule: "0 * * * *", // Every hour
        trigger: { type: "agent", prompt: "Do something" },
      });

      expect(job.id).toBe("test-job-1");
      expect(job.name).toBe("Test Job");
      expect(job.schedule).toBe("0 * * * *");
    });

    it("should reject invalid cron expressions", async () => {
      await scheduler.start();

      await expect(
        scheduler.addJob({
          id: "invalid-job",
          name: "Invalid Job",
          schedule: "invalid cron",
          trigger: { type: "agent", prompt: "Do something" },
        })
      ).rejects.toThrow("Invalid cron expression");
    });

    it("should remove a job", async () => {
      await scheduler.start();

      await scheduler.addJob({
        id: "to-remove",
        name: "Job to Remove",
        schedule: "0 * * * *",
        trigger: { type: "agent", prompt: "Do something" },
      });

      const removed = await scheduler.removeJob("to-remove");
      expect(removed).toBe(true);
    });

    it("should list all jobs", async () => {
      await scheduler.start();

      const jobs = scheduler.listJobs();
      expect(Array.isArray(jobs)).toBe(true);
    });
  });

  describe("event handling", () => {
    it("should emit scheduler_started event on start", async () => {
      const events: SchedulerEvent[] = [];
      scheduler.onEvent((event) => events.push(event));

      await scheduler.start();

      expect(events.some((e) => e.type === "scheduler_started")).toBe(true);
    });

    it("should emit scheduler_stopped event on stop", async () => {
      const events: SchedulerEvent[] = [];
      scheduler.onEvent((event) => events.push(event));

      await scheduler.start();
      await scheduler.stop();

      expect(events.some((e) => e.type === "scheduler_stopped")).toBe(true);
    });

    it("should emit job_added event when adding a job", async () => {
      const events: SchedulerEvent[] = [];
      scheduler.onEvent((event) => events.push(event));

      await scheduler.start();
      await scheduler.addJob({
        id: "event-test",
        name: "Event Test",
        schedule: "0 * * * *",
        trigger: { type: "agent", prompt: "Test" },
      });

      expect(events.some((e) => e.type === "job_added" && e.jobId === "event-test")).toBe(true);
    });

    it("should allow unsubscribing from events", async () => {
      const events: SchedulerEvent[] = [];
      const unsubscribe = scheduler.onEvent((event) => events.push(event));

      await scheduler.start();
      unsubscribe();
      await scheduler.stop();

      // Should only have start event, not stop event
      expect(events.filter((e) => e.type === "scheduler_stopped").length).toBe(0);
    });
  });

  describe("static methods", () => {
    it("should validate cron expressions", () => {
      expect(Scheduler.validateCronExpression("0 * * * *")).toBe(true);
      expect(Scheduler.validateCronExpression("* * * * *")).toBe(true);
      expect(Scheduler.validateCronExpression("invalid")).toBe(false);
    });
  });

  describe("getActiveJobCount", () => {
    it("should return 0 when no jobs are running", () => {
      expect(scheduler.getActiveJobCount()).toBe(0);
    });
  });
});

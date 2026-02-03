import { describe, it, expect, vi, beforeEach } from "vitest";

import { initializeDroneFlights } from "../../../src/scheduler/drone-flights-init.js";

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

describe("initializeDroneFlights", () => {
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = createMockLogger();
  });

  it("registers flights without emitting scheduler events by default", async () => {
    const scheduler = {
      getJob: vi.fn(() => undefined),
      addJob: vi.fn(async () => undefined),
      syncJob: vi.fn(async () => undefined),
      updateJob: vi.fn(async () => undefined),
    };

    const count = await initializeDroneFlights(scheduler as any, logger as any);

    expect(count).toBe(4);
    expect(scheduler.addJob).toHaveBeenCalledTimes(4);
    for (const call of scheduler.addJob.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ emitEvent: false }));
    }
    expect(scheduler.syncJob).not.toHaveBeenCalled();
    expect(scheduler.updateJob).not.toHaveBeenCalled();
  });

  it("uses updateJob when emitEvents is enabled and job exists", async () => {
    const scheduler = {
      getJob: vi.fn((id: string) => (id === "flight:light-check" ? { id } : undefined)),
      addJob: vi.fn(async () => undefined),
      syncJob: vi.fn(async () => undefined),
      updateJob: vi.fn(async () => undefined),
    };

    const count = await initializeDroneFlights(scheduler as any, logger as any, { emitEvents: true });

    expect(count).toBe(4);
    expect(scheduler.updateJob).toHaveBeenCalledWith(
      "flight:light-check",
      expect.objectContaining({ enabled: true })
    );
    expect(scheduler.syncJob).not.toHaveBeenCalled();
  });

  it("continues registering remaining flights when one fails", async () => {
    const scheduler = {
      getJob: vi.fn(() => undefined),
      addJob: vi.fn(async (job: any) => {
        if (job.id === "flight:hourly-maintenance") {
          throw new Error("boom");
        }
      }),
      syncJob: vi.fn(async () => undefined),
      updateJob: vi.fn(async () => undefined),
    };

    const count = await initializeDroneFlights(scheduler as any, logger as any);

    expect(count).toBe(3);
    expect(logger.warn).toHaveBeenCalledWith(expect.any(Object), expect.stringContaining("Failed to register"));
  });
});

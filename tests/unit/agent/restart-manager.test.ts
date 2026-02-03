import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RestartManager, isRestartExitCode, RESTART_EXIT_CODE } from "../../../src/agent/restart-manager.js";

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

describe("RestartManager", () => {
  let stateDir: string;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    vi.clearAllMocks();
    logger = createMockLogger();
    stateDir = await makeTempDir("ant-restart-");
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("initialize() returns no interrupted task when restart.json is missing", async () => {
    const mgr = new RestartManager({ logger: logger as any, stateDir });
    const result = await mgr.initialize();
    expect(result.hadInterruptedTask).toBe(false);
  });

  it("initialize() returns interrupted task context and clears restart.json", async () => {
    const restartFile = path.join(stateDir, "restart.json");
    await fs.writeFile(
      restartFile,
      JSON.stringify(
        {
          requested: true,
          requestedAt: Date.now(),
          reason: "user_request",
          taskContext: {
            id: "task-1",
            type: "chat",
            startedAt: Date.now(),
            state: { a: 1 },
            toolsExecuted: ["read"],
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const mgr = new RestartManager({ logger: logger as any, stateDir });
    const result = await mgr.initialize();

    expect(result.hadInterruptedTask).toBe(true);
    expect(result.taskContext?.id).toBe("task-1");

    await expect(fs.readFile(restartFile, "utf-8")).rejects.toThrow();
    expect(logger.info).toHaveBeenCalled();
  });

  it("requestRestart() writes restart.json, runs shutdown handlers, and exits (delayed)", async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);

    const mgr = new RestartManager({ logger: logger as any, stateDir });
    const handler = vi.fn(async () => {});
    mgr.onShutdown(handler);

    await mgr.requestRestart({
      reason: "config_change",
      message: "restarting",
      metadata: { ok: true },
    });

    expect(handler).toHaveBeenCalledWith("config_change");

    const restartFile = path.join(stateDir, "restart.json");
    const raw = await fs.readFile(restartFile, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.requested).toBe(true);
    expect(parsed.reason).toBe("config_change");
    expect(parsed.message).toBe("restarting");
    expect(parsed.metadata).toEqual({ ok: true });

    await vi.runOnlyPendingTimersAsync();
    expect(exitSpy).toHaveBeenCalledWith(42);
  });

  it("cancelRestart() clears pending restart when not shutting down", async () => {
    const restartFile = path.join(stateDir, "restart.json");
    await fs.writeFile(
      restartFile,
      JSON.stringify({ requested: true, requestedAt: Date.now(), reason: "scheduled" }, null, 2),
      "utf-8"
    );

    const mgr = new RestartManager({ logger: logger as any, stateDir });
    expect(await mgr.isRestartPending()).toBe(true);
    expect(await mgr.cancelRestart()).toBe(true);
    expect(await mgr.isRestartPending()).toBe(false);
  });

  it("saveTaskContext() and clearTaskContext() round-trip", async () => {
    const mgr = new RestartManager({ logger: logger as any, stateDir });
    const ctx = mgr.createTaskContext({ type: "chat", query: "hello" });
    await mgr.saveTaskContext(ctx);

    const restartFile = path.join(stateDir, "restart.json");
    const raw = await fs.readFile(restartFile, "utf-8");
    expect(raw).toContain(ctx.id);

    await mgr.clearTaskContext();
    const raw2 = await fs.readFile(restartFile, "utf-8");
    expect(raw2).not.toContain(ctx.id);
  });

  it("isRestartExitCode() matches the configured restart exit code", () => {
    expect(RESTART_EXIT_CODE).toBe(42);
    expect(isRestartExitCode(42)).toBe(true);
    expect(isRestartExitCode(0)).toBe(false);
  });
});

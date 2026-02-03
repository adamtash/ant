import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MainAgent } from "../../../src/agent/main-agent.js";
import { TaskLane } from "../../../src/agent/concurrency/lanes.js";

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

async function waitFor<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

describe("MainAgent", () => {
  const ownerJid = "owner@s.whatsapp.net";
  let workspaceDir: string;
  let stateDir: string;
  let configDir: string;
  let configPath: string;

  beforeEach(async () => {
    workspaceDir = await makeTempDir("ant-workspace-");
    stateDir = await makeTempDir("ant-state-");
    configDir = await makeTempDir("ant-config-");
    configPath = path.join(configDir, "ant.config.json");
    await fs.writeFile(configPath, JSON.stringify({ ok: true }), "utf-8");
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Record<string, unknown> = {}) {
    return {
      resolved: {
        workspaceDir,
        stateDir,
        configPath,
      },
      whatsapp: {
        ownerJids: [ownerJid],
        startupRecipients: [],
      },
      mainAgent: {
        enabled: true,
        intervalMs: 60_000,
        dutiesFile: "AGENT_DUTIES.md",
      },
      agentExecution: {
        lanes: {
          main: { maxConcurrent: 1 },
          autonomous: { maxConcurrent: 1 },
          maintenance: { maxConcurrent: 1 },
        },
        monitoring: { timeoutCheckIntervalMs: 50 },
        tasks: {
          defaults: {
            timeoutMs: 5_000,
            maxRetries: 2,
            retryBackoffMs: 10,
            retryBackoffMultiplier: 1,
            retryBackoffCap: 10,
          },
          registry: { cacheTtlMs: 5_000 },
        },
        subagents: { timeoutMs: 2_000, maxRetries: 1 },
      },
      ...overrides,
    } as any;
  }

  function makeAgentEngine() {
    return {
      execute: vi.fn(async ({ query }: { query: string }) => {
        if (query.includes("STARTUP HEALTH CHECK")) {
          return {
            response: "HEALTH OK",
            toolsUsed: [],
            iterations: 1,
            providerId: "test-provider",
            model: "test-model",
          };
        }

        if (query.includes("PHASE: PLANNING")) {
          return {
            response: "Plan: do the thing",
            toolsUsed: [],
            iterations: 1,
            providerId: "test-provider",
            model: "test-model",
          };
        }

        if (query.includes("PHASE: EXECUTING")) {
          return {
            response: "Executed",
            toolsUsed: ["write"],
            iterations: 2,
            providerId: "test-provider",
            model: "test-model",
          };
        }

        if (query.includes("PHASE: VERIFYING")) {
          return {
            response: "Verified",
            toolsUsed: [],
            iterations: 1,
            providerId: "test-provider",
            model: "test-model",
          };
        }

        return {
          response: "OK",
          toolsUsed: [],
          iterations: 1,
          providerId: "test-provider",
          model: "test-model",
        };
      }),
    } as any;
  }

  it("start() sends startup message and health check to WhatsApp owners", async () => {
    const logger = createMockLogger();
    const agentEngine = makeAgentEngine();
    const sendMessage = vi.fn(async () => {});
    const sessionManager = { appendMessage: vi.fn(async () => {}) } as any;

    const mainAgent = new MainAgent({
      config: makeConfig(),
      agentEngine,
      logger,
      sendMessage,
      sessionManager,
    });

    // Prevent autonomous duties from triggering during the test.
    (mainAgent as any).autonomousRunning = true;

    await mainAgent.start();

    expect(sendMessage).toHaveBeenCalledWith(ownerJid, expect.stringContaining("Queen Ant Started"));
    expect(sendMessage).toHaveBeenCalledWith(ownerJid, expect.stringContaining("HEALTH OK"));
    expect(sessionManager.appendMessage).toHaveBeenCalledWith(
      expect.stringContaining("agent:main:startup-health"),
      expect.objectContaining({ role: "assistant", content: "HEALTH OK" })
    );

    mainAgent.stop();
  });

  it("assignTask() executes via subagent phases and stores result", async () => {
    const logger = createMockLogger();
    const agentEngine = makeAgentEngine();

    const mainAgent = new MainAgent({
      config: makeConfig(),
      agentEngine,
      logger,
    });

    await (mainAgent as any).taskStore.initialize();

    const taskId = await mainAgent.assignTask("Test task", 1);

    const task = await waitFor(
      () => mainAgent.getTask(taskId),
      (value) => !!value && value.status === "succeeded" && !!value.result,
      5_000
    );

    expect(task.status).toBe("succeeded");
    expect(task.result?.content).toBe("Verified");
    expect(task.subagentSessionKey).toContain("agent:main:subagent");
    expect(agentEngine.execute).toHaveBeenCalledWith(
      expect.objectContaining({ isSubagent: true })
    );
  });

  it("handleFailure() schedules retry when attempts remain", async () => {
    const logger = createMockLogger();
    const agentEngine = makeAgentEngine();

    const mainAgent = new MainAgent({
      config: makeConfig(),
      agentEngine,
      logger,
    });

    await (mainAgent as any).taskStore.initialize();

    const task = await (mainAgent as any).taskStore.create({
      description: "Retry me",
      sessionKey: "test-session",
      lane: TaskLane.Main,
      metadata: { channel: "cli", priority: "high", tags: [] },
      retries: { maxAttempts: 3 },
      timeoutMs: 10_000,
    });

    const enqueueWithDelay = vi.fn();
    (mainAgent as any).taskQueue.enqueueWithDelay = enqueueWithDelay;

    await (mainAgent as any).handleFailure(task, "boom");

    const updated = await (mainAgent as any).taskStore.get(task.taskId);
    expect(updated?.status).toBe("retrying");
    expect(updated?.retries.attempted).toBe(1);
    expect(updated?.retries.backoffMs).toBe(10);
    expect(updated?.retries.nextRetryAt).toBeTypeOf("number");
    expect(updated?.error).toBe("boom");
    expect(enqueueWithDelay).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      TaskLane.Main,
      expect.any(Function),
      10
    );
  });

  it("handleFailure() marks failed when max attempts reached", async () => {
    const logger = createMockLogger();
    const agentEngine = makeAgentEngine();

    const mainAgent = new MainAgent({
      config: makeConfig(),
      agentEngine,
      logger,
    });

    await (mainAgent as any).taskStore.initialize();

    const task = await (mainAgent as any).taskStore.create({
      description: "Fail me",
      sessionKey: "test-session",
      lane: TaskLane.Main,
      metadata: { channel: "cli", priority: "high", tags: [] },
      retries: { maxAttempts: 1 },
      timeoutMs: 10_000,
    });

    const enqueueWithDelay = vi.fn();
    (mainAgent as any).taskQueue.enqueueWithDelay = enqueueWithDelay;

    await (mainAgent as any).handleFailure(task, "boom");

    const updated = await (mainAgent as any).taskStore.get(task.taskId);
    expect(updated?.status).toBe("failed");
    expect(updated?.error).toBe("boom");
    expect(enqueueWithDelay).not.toHaveBeenCalled();
  });

  it("loadDuties() reads from workspace and falls back to defaults", async () => {
    const logger = createMockLogger();
    const agentEngine = makeAgentEngine();

    const dutiesPath = path.join(workspaceDir, "AGENT_DUTIES.md");
    await fs.writeFile(dutiesPath, "WORKSPACE DUTIES", "utf-8");

    const mainAgent = new MainAgent({
      config: makeConfig(),
      agentEngine,
      logger,
    });

    const duties = await (mainAgent as any).loadDuties();
    expect(duties).toBe("WORKSPACE DUTIES");

    await fs.rm(dutiesPath, { force: true });

    const defaultDuties = await (mainAgent as any).loadDuties();
    expect(defaultDuties).toContain("Autonomous Main Agent Duties");
  });
});


import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function createMockChildProcess(params: { code?: number; stdout?: string; stderr?: string }) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  setTimeout(() => {
    if (params.stdout) child.stdout.emit("data", Buffer.from(params.stdout));
    if (params.stderr) child.stderr.emit("data", Buffer.from(params.stderr));
    child.emit("close", params.code ?? 0);
  }, 0);

  return child;
}

function makeCtx() {
  return {
    workspaceDir: "/tmp",
    stateDir: "/tmp",
    sessionKey: "test-session",
    logger: mockLogger as any,
    config: {} as any,
  };
}

describe("exec tool delete guard", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
    delete process.env.ANT_EXEC_BLOCK_DELETE;
  });

  afterEach(() => {
    delete process.env.ANT_EXEC_BLOCK_DELETE;
  });

  it("blocks rm when ANT_EXEC_BLOCK_DELETE=1", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute({ command: "rm", args: ["-rf", "whatever"] }, makeCtx());

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/blocked delete command/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("blocks find -delete when ANT_EXEC_BLOCK_DELETE=1", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute({ command: "find", args: [".", "-delete"] }, makeCtx());

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/blocked delete command/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("blocks python delete patterns when ANT_EXEC_BLOCK_DELETE=1", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute(
      { command: "python3", args: ["-c", "import os; os.remove('whatever')"] },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/blocked delete command/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("blocks node delete patterns when ANT_EXEC_BLOCK_DELETE=1", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute(
      { command: "node", args: ["-e", "const fs=require('fs'); fs.rmSync('whatever', { force: true, recursive: true });"] },
      makeCtx()
    );

    expect(result.ok).toBe(false);
    expect(String(result.error)).toMatch(/blocked delete command/i);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("allows non-destructive commands when ANT_EXEC_BLOCK_DELETE=1", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "1";
    spawnMock.mockImplementation(() => createMockChildProcess({ code: 0, stdout: "ok\n" }));
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute({ command: "echo", args: ["ok"] }, makeCtx());

    expect(result.ok).toBe(true);
    expect((result.data as any).stdout).toBe("ok");
    expect(spawnMock).toHaveBeenCalled();
  });

  it("allows rm when delete guard is disabled", async () => {
    process.env.ANT_EXEC_BLOCK_DELETE = "0";
    spawnMock.mockImplementation(() => createMockChildProcess({ code: 0, stdout: "" }));
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute({ command: "rm", args: ["-rf", "whatever"] }, makeCtx());

    expect(result.ok).toBe(true);
    expect(spawnMock).toHaveBeenCalled();
  });

  it("returns a timeout error when command times out", async () => {
    delete process.env.ANT_EXEC_BLOCK_DELETE;

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      setTimeout(() => child.emit("close", 137), 0);
      return true;
    });

    spawnMock.mockImplementation(() => child);
    const tool = (await import("../../../src/tools/built-in/system/exec.js")).default;

    const result = await tool.execute({ command: "sleep", args: ["5"], timeoutMs: 1 }, makeCtx());

    expect(result.ok).toBe(false);
    expect(result.metadata?.timedOut).toBe(true);
    expect(String(result.error)).toMatch(/timed out/i);
    expect(child.kill).toHaveBeenCalled();
  });
});

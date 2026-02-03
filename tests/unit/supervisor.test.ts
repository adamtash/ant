import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const { state, spawnMock, watchMock } = vi.hoisted(() => {
  const state = {
    nextExitCodes: [] as Array<number | null>,
    watcher: undefined as any,
  };

  const spawnMock = vi.fn(() => {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const child: any = {
      pid: 1000 + spawnMock.mock.calls.length,
      kill: vi.fn(),
      on: (event: string, cb: (...args: any[]) => void) => {
        const current = listeners.get(event) ?? [];
        current.push(cb);
        listeners.set(event, current);
        return child;
      },
      emit: (event: string, ...args: any[]) => {
        const current = listeners.get(event) ?? [];
        for (const cb of current) cb(...args);
      },
    };

    const exitCode = state.nextExitCodes.length > 0 ? state.nextExitCodes.shift()! : 0;
    setImmediate(() => child.emit("spawn"));
    setImmediate(() => child.emit("exit", exitCode, null));
    return child;
  });

  const watchMock = vi.fn(() => {
    const watcher: any = {
      close: vi.fn(),
      on: vi.fn(() => watcher),
    };
    state.watcher = watcher;
    return watcher;
  });

  return { state, spawnMock, watchMock };
});

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({ watch: watchMock }));

import { Supervisor, parseArgs } from "../../src/supervisor.js";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("Supervisor", () => {
  let stateDir: string;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    state.nextExitCodes = [];
    state.watcher = undefined;
    stateDir = await makeTempDir("ant-supervisor-");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("parseArgs() recognizes help and basic options", () => {
    expect(parseArgs(["--help"]).help).toBe(true);

    const parsed = parseArgs(["--restart-delay", "2000", "--max-restarts", "5", "--state-dir", "/tmp/state"]);
    expect(parsed.help).toBe(false);
    expect(parsed.config.restartDelayMs).toBe(2000);
    expect(parsed.config.maxRestarts).toBe(5);
    expect(parsed.config.stateDir).toBe("/tmp/state");
  });

  it("start() spawns child and exits cleanly when child exits 0", async () => {
    state.nextExitCodes = [0];

    const supervisor = new Supervisor({
      stateDir,
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: process.cwd(),
      restartDelayMs: 0,
      maxRestarts: 5,
      restartWindowMs: 60_000,
    });

    await supervisor.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(watchMock).toHaveBeenCalled();
    expect(state.watcher.close).toHaveBeenCalledTimes(1);
  });

  it("restarts when child exits with code 42", async () => {
    state.nextExitCodes = [42, 0];

    const supervisor = new Supervisor({
      stateDir,
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: process.cwd(),
      restartDelayMs: 0,
      maxRestarts: 5,
      restartWindowMs: 60_000,
    });

    await supervisor.start();

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("exits when restart limits are exceeded", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as any);

    const supervisor = new Supervisor({
      stateDir,
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: process.cwd(),
      restartDelayMs: 0,
      maxRestarts: 0,
      restartWindowMs: 60_000,
    });

    await expect(supervisor.start()).rejects.toThrow("exit:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

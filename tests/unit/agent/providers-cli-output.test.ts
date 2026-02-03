import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";

import { CLIProvider } from "../../../src/agent/providers.js";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: any[]) => spawnMock(...args),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

describe("CLIProvider placeholders", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("substitutes {output} and reads output file content", async () => {
    let observedOutputPath: string | null = null;

    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const child = new EventEmitter() as any;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.kill = vi.fn();

      const outputArg = args.find((a) => typeof a === "string" && a.includes("ant-cli-codex-output-"));
      observedOutputPath = outputArg ?? null;

      void (async () => {
        if (observedOutputPath) {
          await fs.writeFile(observedOutputPath, "FILE_OUT", "utf-8");
        }
        setTimeout(() => child.emit("close", 0), 0);
      })();

      return child;
    });

    const provider = new CLIProvider({
      id: "codex",
      cliType: "codex",
      model: "test-model",
      logger: mockLogger as any,
      command: "codex",
      args: ["exec", "--output-last-message", "{output}", "-"],
      timeoutMs: 10_000,
    });

    const res = await provider.chat([{ role: "user", content: "hi" }]);

    const spawnedArgs = spawnMock.mock.calls[0]?.[1] as string[] | undefined;
    expect(Array.isArray(spawnedArgs)).toBe(true);
    expect(spawnedArgs).not.toContain("{output}");
    expect(observedOutputPath).toBeTruthy();
    expect(res.content.trim()).toBe("FILE_OUT");

    // The provider should clean up the temp output file.
    if (observedOutputPath) {
      await expect(fs.access(observedOutputPath)).rejects.toThrow();
    }
  });
});


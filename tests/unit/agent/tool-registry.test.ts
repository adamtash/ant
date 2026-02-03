import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ToolRegistry } from "../../../src/agent/tool-registry.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

describe("ToolRegistry", () => {
  let workspaceDir: string;
  let stateDir: string;

  beforeAll(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-tool-registry-workspace-"));
    stateDir = path.join(workspaceDir, ".ant");
    await fs.mkdir(stateDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("loads built-in tools and can execute file tools", async () => {
    const registry = new ToolRegistry({
      logger: mockLogger as any,
      builtInDir: path.join(PROJECT_ROOT, "src/tools/built-in"),
      dynamicDir: path.join(PROJECT_ROOT, "src/tools/dynamic"),
    });
    await registry.initialize();

    expect(registry.count).toBeGreaterThan(0);
    expect(registry.has("read")).toBe(true);
    expect(registry.has("write")).toBe(true);
    expect(registry.has("ls")).toBe(true);
    expect(registry.has("exec")).toBe(true);

    const ctx = {
      workspaceDir,
      stateDir,
      sessionKey: "test-session",
      logger: mockLogger as any,
      config: {} as any,
    };

    const write = await registry.execute("write", { path: "hello.txt", content: "hello\nworld\n" }, ctx);
    expect(write.ok).toBe(true);

    const read = await registry.execute("read", { path: "hello.txt", from: 2, lines: 1 }, ctx);
    expect(read.ok).toBe(true);
    expect((read.data as any).text.trim()).toBe("world");

    await fs.writeFile(path.join(workspaceDir, ".hidden"), "x", "utf-8");
    const lsNoHidden = await registry.execute("ls", {}, ctx);
    expect(lsNoHidden.ok).toBe(true);
    const namesNoHidden = ((lsNoHidden.data as any).entries as any[]).map((e) => e.name);
    expect(namesNoHidden).not.toContain(".hidden");

    const lsHidden = await registry.execute("ls", { all: true }, ctx);
    expect(lsHidden.ok).toBe(true);
    const namesHidden = ((lsHidden.data as any).entries as any[]).map((e) => e.name);
    expect(namesHidden).toContain(".hidden");
  });

  it("returns a helpful error for unknown tools", async () => {
    const registry = new ToolRegistry({
      logger: mockLogger as any,
      builtInDir: path.join(PROJECT_ROOT, "src/tools/built-in"),
      dynamicDir: path.join(PROJECT_ROOT, "src/tools/dynamic"),
    });
    await registry.initialize();

    const ctx = {
      workspaceDir,
      stateDir,
      sessionKey: "test-session",
      logger: mockLogger as any,
      config: {} as any,
    };

    const res = await registry.execute("nope", {}, ctx);
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/unknown tool/i);
  });
});


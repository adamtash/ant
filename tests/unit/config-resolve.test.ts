import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { resolveConfigPath } from "../../src/config.js";

describe("resolveConfigPath()", () => {
  it("uses explicit path when provided", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-resolve-"));
    const configPath = path.join(tempDir, "ant.config.json");
    await fs.writeFile(configPath, JSON.stringify({ workspaceDir: "." }), "utf-8");

    expect(resolveConfigPath(configPath)).toBe(path.resolve(configPath));
  });

  it("expands ~ in explicit path", async () => {
    expect(resolveConfigPath("~/.ant/ant.config.json")).toBe(path.join(os.homedir(), ".ant", "ant.config.json"));
  });

  it("uses ANT_CONFIG_PATH when set", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-resolve-env-"));
    const configPath = path.join(tempDir, "ant.config.json");
    await fs.writeFile(configPath, JSON.stringify({ workspaceDir: "." }), "utf-8");

    const original = process.env.ANT_CONFIG_PATH;
    try {
      process.env.ANT_CONFIG_PATH = configPath;
      expect(resolveConfigPath()).toBe(path.resolve(configPath));
    } finally {
      if (original === undefined) {
        delete process.env.ANT_CONFIG_PATH;
      } else {
        process.env.ANT_CONFIG_PATH = original;
      }
    }
  });

  it("discovers nearest ant.config.json upwards from cwd", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-resolve-up-"));
    const projectDir = path.join(tempRoot, "project");
    const subdir = path.join(projectDir, "nested");
    await fs.mkdir(subdir, { recursive: true });

    const configPath = path.join(projectDir, "ant.config.json");
    await fs.writeFile(configPath, JSON.stringify({ workspaceDir: "." }), "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(subdir);
    const originalEnv = process.env.ANT_CONFIG_PATH;
    const originalEnvLegacy = process.env.ANT_CONFIG;
    try {
      delete process.env.ANT_CONFIG_PATH;
      delete process.env.ANT_CONFIG;

      expect(resolveConfigPath()).toBe(path.resolve(configPath));
    } finally {
      cwdSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.ANT_CONFIG_PATH;
      } else {
        process.env.ANT_CONFIG_PATH = originalEnv;
      }
      if (originalEnvLegacy === undefined) {
        delete process.env.ANT_CONFIG;
      } else {
        process.env.ANT_CONFIG = originalEnvLegacy;
      }
    }
  });

  it("falls back to ~/.ant/ant.config.json when nothing else applies", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-resolve-fallback-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    const originalEnv = process.env.ANT_CONFIG_PATH;
    const originalEnvLegacy = process.env.ANT_CONFIG;
    try {
      delete process.env.ANT_CONFIG_PATH;
      delete process.env.ANT_CONFIG;

      expect(resolveConfigPath()).toBe(path.join(os.homedir(), ".ant", "ant.config.json"));
    } finally {
      cwdSpy.mockRestore();
      if (originalEnv === undefined) {
        delete process.env.ANT_CONFIG_PATH;
      } else {
        process.env.ANT_CONFIG_PATH = originalEnv;
      }
      if (originalEnvLegacy === undefined) {
        delete process.env.ANT_CONFIG;
      } else {
        process.env.ANT_CONFIG = originalEnvLegacy;
      }
    }
  });
});

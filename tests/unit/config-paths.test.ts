import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config.js";

describe("config path resolution", () => {
  it("does not create nested .ant paths when workspaceDir is ~/.ant", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-paths-"));
    const configPath = path.join(tempDir, "ant.config.json");

    const rawConfig = {
      workspaceDir: "~/.ant",
      stateDir: ".ant",
      provider: {
        type: "openai",
        baseUrl: "http://localhost:1234/v1",
        model: "local-model",
      },
      whatsapp: {
        sessionDir: ".ant/whatsapp",
      },
      memory: {
        sqlitePath: ".ant/memory.sqlite",
        embeddingsModel: "text-embedding-test",
      },
      runtime: {
        worker: {
          heartbeatPath: ".ant/heartbeat.worker",
        },
      },
      mainAgent: {
        logFile: ".ant/AGENT_LOG.md",
      },
    };

    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), "utf-8");
    const cfg = await loadConfig(configPath);

    const expectedStateDir = path.join(os.homedir(), ".ant");
    expect(cfg.resolved.workspaceDir).toBe(expectedStateDir);
    expect(cfg.resolved.stateDir).toBe(expectedStateDir);
    expect(cfg.resolved.memorySqlitePath).toBe(path.join(expectedStateDir, "memory.sqlite"));
    expect(cfg.resolved.whatsappSessionDir).toBe(path.join(expectedStateDir, "whatsapp"));
    expect(cfg.runtime.worker.heartbeatPath).toBe(path.join(expectedStateDir, "heartbeat.worker"));
    expect(cfg.mainAgent.logFile).toBe(path.join(expectedStateDir, "AGENT_LOG.md"));
    expect(cfg.agentExecution.tasks.registry.dir).toBe(path.join(expectedStateDir, "tasks"));
  });

  it("keeps legacy .ant relative paths anchored to stateDir for non-.ant workspaces", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ant-config-paths-workspace-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    const configPath = path.join(tempRoot, "ant.config.json");

    const rawConfig = {
      workspaceDir,
      provider: {
        type: "openai",
        baseUrl: "http://localhost:1234/v1",
        model: "local-model",
      },
      whatsapp: {
        sessionDir: ".ant/whatsapp",
      },
      memory: {
        sqlitePath: ".ant/memory.sqlite",
        embeddingsModel: "text-embedding-test",
      },
    };

    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), "utf-8");
    const cfg = await loadConfig(configPath);

    const expectedStateDir = path.join(workspaceDir, ".ant");
    expect(cfg.resolved.stateDir).toBe(expectedStateDir);
    expect(cfg.resolved.memorySqlitePath).toBe(path.join(expectedStateDir, "memory.sqlite"));
    expect(cfg.resolved.whatsappSessionDir).toBe(path.join(expectedStateDir, "whatsapp"));
    expect(cfg.agentExecution.tasks.registry.dir).toBe(path.join(expectedStateDir, "tasks"));
  });
});

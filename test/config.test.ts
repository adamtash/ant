import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/config.js";

const tmpConfig = path.join(process.cwd(), ".ant.test.config.json");

test("loadConfig resolves defaults", async () => {
  await fs.writeFile(
    tmpConfig,
    JSON.stringify({
      provider: { baseUrl: "http://localhost:1234/v1", model: "test", embeddingsModel: "embed" },
      whatsapp: { sessionDir: "./.ant/whatsapp" },
      memory: {
        enabled: true,
        indexSessions: true,
        sqlitePath: "./.ant/memory.sqlite",
        embeddingsModel: "embed"
      },
      subagents: { enabled: true }
    }),
    "utf-8",
  );
  const cfg = await loadConfig(tmpConfig);
  assert.equal(cfg.resolved.providers.default, "default");
  assert.equal(cfg.resolved.providers.items.default.baseUrl, "http://localhost:1234/v1");
  assert.equal(cfg.memory.sync.onSearch, true);
  assert.equal(cfg.memory.sync.intervalMinutes, 0);
  assert.ok(cfg.resolved.stateDir.length > 0);
  await fs.unlink(tmpConfig).catch(() => {});
});

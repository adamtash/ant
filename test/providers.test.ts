import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import { ProviderClients } from "../src/runtime/providers.js";

const tmpConfig = path.join(process.cwd(), ".ant.test.providers.json");

test("ProviderClients routes per action and model overrides", async () => {
  await fs.writeFile(
    tmpConfig,
    JSON.stringify({
      providers: {
        default: "lm",
        items: {
          lm: {
            type: "openai",
            baseUrl: "http://localhost:1234/v1",
            model: "base-model",
            models: { tools: "tool-model" },
          },
          "codex-cli": {
            type: "cli",
            cliProvider: "codex",
            model: "codex",
            models: { chat: "codex-chat" },
          },
        },
      },
      routing: {
        chat: "codex-cli",
        tools: "lm",
        embeddings: "lm",
      },
      whatsapp: { sessionDir: "./.ant/whatsapp" },
      memory: {
        enabled: true,
        indexSessions: true,
        sqlitePath: "./.ant/memory.sqlite",
        embeddingsModel: "embed",
      },
      subagents: { enabled: true },
    }),
    "utf-8",
  );
  const cfg = await loadConfig(tmpConfig);
  const providers = new ProviderClients(cfg);

  const chat = providers.resolveProvider("chat");
  assert.equal(chat.id, "codex-cli");
  assert.equal(chat.type, "cli");
  assert.equal(chat.modelForAction, "codex-chat");

  const tools = providers.resolveProvider("tools");
  assert.equal(tools.id, "lm");
  assert.equal(tools.type, "openai");
  assert.equal(tools.modelForAction, "tool-model");

  const fallback = providers.resolveProviderById("missing", "chat");
  assert.equal(fallback.id, "lm");
  assert.equal(fallback.modelForAction, "base-model");

  await fs.unlink(tmpConfig).catch(() => {});
});

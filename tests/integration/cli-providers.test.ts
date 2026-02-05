import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { CLIProvider } from "../../src/agent/providers.js";
import { loadConfig } from "../../src/config.js";

const integrationEnabled = process.env.ANT_CLI_INTEGRATION === "1";
const configPath =
  process.env.ANT_CONFIG ||
  process.env.ANT_CONFIG_PATH ||
  path.resolve("ant.config.example.json");
const providerFilter = (process.env.ANT_CLI_PROVIDERS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowRateLimit = (process.env.ANT_CLI_ALLOW_RATE_LIMIT || "").trim() === "1";

const maybeDescribe = integrationEnabled ? describe : describe.skip;

function commandExists(command: string): boolean {
  const res = spawnSync("which", [command], { stdio: "ignore" });
  return res.status === 0;
}

maybeDescribe("CLI providers (integration)", async () => {
  const cfg = await loadConfig(configPath);
  const timeoutMs = Number.parseInt(
    process.env.ANT_CLI_TIMEOUT_MS || String(cfg.cliTools.timeoutMs ?? 1200000),
    10
  );
  const providers = Object.entries(cfg.providers.items)
    .filter(([, provider]) => provider.type === "cli")
    .filter(([id, provider]) => {
      if (providerFilter.length === 0) return true;
      return providerFilter.includes(id) || providerFilter.includes(provider.cliProvider || "");
    })
    .map(([id, provider]) => ({ id, provider }));

  if (providers.length === 0) {
    it("no CLI providers configured", () => {
      expect(providers.length).toBeGreaterThan(0);
    });
    return;
  }

  for (const { id, provider } of providers) {
    const cliType = provider.cliProvider || "claude";
    const command = provider.command || cliType;

    it(
      `${id} responds to a basic prompt`,
      async function () {
      if (!commandExists(command)) {
        return;
      }

      const cli = new CLIProvider({
        id,
        cliType,
        model: provider.model,
        logger: {
          info: console.log,
          warn: console.warn,
          error: console.error,
          debug: console.debug,
          child: function () { return this as any; },
        } as any,
        command,
        args: provider.args || [],
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20000,
      });

      try {
        const res = await cli.chat([{ role: "user", content: "Reply with: OK" }], {
          timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000,
        });

        expect(res.content.trim().length).toBeGreaterThan(0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (allowRateLimit && /rate limit/i.test(message)) {
          this.skip();
          return;
        }
        throw err;
      }
    },
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60000
    );
  }
});

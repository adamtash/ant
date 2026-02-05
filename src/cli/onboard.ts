/**
 * Onboard Command - interactive setup wizard
 *
 * Writes:
 * - Config: ant.config.json (non-secrets)
 * - Env: .env (secrets + optional overrides)
 */

import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";

import chalk from "chalk";

import { applyEnvUpdates, resolveEnvFilePath } from "../env-file.js";
import { validateConfigObject } from "../config.js";
import { OutputFormatter } from "./output-formatter.js";

export interface OnboardOptions {
  config?: string;
  env?: string;
  force?: boolean;
  quiet?: boolean;
}

type ProviderChoice = "lmstudio" | "openai" | "cli";

function resolveUserPath(value: string, baseDir?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return baseDir ? path.resolve(baseDir, trimmed) : path.resolve(trimmed);
}

function configExists(configPath: string): boolean {
  try {
    return fsSync.existsSync(configPath) && fsSync.statSync(configPath).isFile();
  } catch {
    return false;
  }
}

function detectCliTools(): Array<"codex" | "copilot" | "claude" | "kimi"> {
  const tools: Array<"codex" | "copilot" | "claude" | "kimi"> = [];
  for (const tool of ["codex", "copilot", "claude", "kimi"] as const) {
    try {
      execSync(`which ${tool}`, { stdio: "ignore" });
      tools.push(tool);
    } catch {
      // ignore
    }
  }
  return tools;
}

async function detectLmStudio(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 1000);
    const res = await fetch("http://localhost:1234/v1/models", { signal: ctrl.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function createBaseConfig(): Record<string, unknown> {
  return {
    workspaceDir: ".",
    providers: {
      default: "lmstudio",
      items: {
        lmstudio: {
          type: "openai",
          baseUrl: "http://localhost:1234/v1",
          model: "local-model",
          embeddingsModel: "text-embedding-nomic-embed-text-v1.5",
        },
      },
      fallbackChain: [],
      discovery: {
        enabled: false,
      },
    },
    routing: {
      chat: "lmstudio",
      tools: "lmstudio",
      embeddings: "lmstudio",
      parentForCli: "lmstudio",
    },
    ui: {
      enabled: true,
      host: "127.0.0.1",
      port: 5117,
      autoOpen: true,
      openUrl: "http://127.0.0.1:5117",
      staticDir: "ui/dist",
    },
    telegram: {
      enabled: false,
      mode: "polling",
      dmPolicy: "pairing",
      // botToken intentionally omitted; store it in .env as ANT_TELEGRAM_BOT_TOKEN.
    },
    whatsapp: {
      sessionDir: ".ant/whatsapp",
      respondToGroups: false,
      mentionOnly: true,
      botName: "ant",
      respondToSelfOnly: true,
      allowSelfMessages: true,
      resetOnLogout: true,
      typingIndicator: true,
      mentionKeywords: ["ant"],
      ownerJids: [],
    },
    memory: {
      enabled: true,
      indexSessions: true,
      retentionDays: 30,
      sqlitePath: ".ant/memory.sqlite",
      embeddingsModel: "text-embedding-nomic-embed-text-v1.5",
    },
    scheduler: {
      enabled: true,
      storePath: ".ant/jobs.json",
      timezone: "UTC",
    },
    gateway: {
      enabled: true,
      port: 18789,
      host: "127.0.0.1",
    },
    logging: {
      level: "info",
      fileLevel: "trace",
      filePath: ".ant/ant.log",
    },
    mainAgent: {
      enabled: true,
      intervalMs: 300_000,
      dutiesFile: "AGENT_DUTIES.md",
      logFile: ".ant/AGENT_LOG.md",
    },
    runtime: {
      mode: "split",
    },
  };
}

function setProviderConfig(params: {
  base: Record<string, unknown>;
  choice: ProviderChoice;
  lmstudio?: { baseUrl: string; model: string; embeddingsModel: string };
  openai?: { model: string; embeddingsModel: string };
  cli?: { tool: "codex" | "copilot" | "claude" | "kimi"; model: string };
  useLmStudioForEmbeddings: boolean;
}): void {
  const providers = (params.base.providers ?? {}) as Record<string, unknown>;
  const items = ((providers.items ?? {}) as Record<string, unknown>) ?? {};

  if (params.choice === "lmstudio" && params.lmstudio) {
    items.lmstudio = {
      type: "openai",
      baseUrl: params.lmstudio.baseUrl,
      model: params.lmstudio.model,
      embeddingsModel: params.lmstudio.embeddingsModel,
    };
    (providers as any).default = "lmstudio";
    (providers as any).items = items;
    params.base.providers = providers;
    params.base.routing = {
      chat: "lmstudio",
      tools: "lmstudio",
      embeddings: "lmstudio",
      parentForCli: "lmstudio",
    };
    (params.base.memory as any).embeddingsModel = params.lmstudio.embeddingsModel;
    return;
  }

  if (params.choice === "openai" && params.openai) {
    items.openai = {
      type: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: params.openai.model,
      embeddingsModel: params.openai.embeddingsModel,
    };
    (providers as any).default = "openai";
    (providers as any).items = items;
    params.base.providers = providers;
    params.base.routing = {
      chat: "openai",
      tools: "openai",
      embeddings: "openai",
      parentForCli: "openai",
    };
    (params.base.memory as any).embeddingsModel = params.openai.embeddingsModel;
    return;
  }

  if (params.choice === "cli" && params.cli) {
    const id = params.cli.tool;
    items[id] = {
      type: "cli",
      cliProvider: params.cli.tool,
      model: params.cli.model,
    };

    if (params.useLmStudioForEmbeddings && params.lmstudio) {
      items.lmstudio = {
        type: "openai",
        baseUrl: params.lmstudio.baseUrl,
        model: params.lmstudio.model,
        embeddingsModel: params.lmstudio.embeddingsModel,
      };
    }

    (providers as any).default = id;
    (providers as any).items = items;
    params.base.providers = providers;

    const embeddingsProvider = params.useLmStudioForEmbeddings ? "lmstudio" : id;
    params.base.routing = {
      chat: id,
      tools: id,
      embeddings: embeddingsProvider,
      parentForCli: id,
    };

    if (params.useLmStudioForEmbeddings && params.lmstudio) {
      (params.base.memory as any).embeddingsModel = params.lmstudio.embeddingsModel;
    } else {
      // CLI providers cannot embed; disable memory to avoid confusing runtime errors.
      (params.base.memory as any).enabled = false;
    }
  }
}

export async function onboard(options: OnboardOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  const configPath = resolveUserPath(
    options.config || path.join(os.homedir(), ".ant", "ant.config.json"),
  );
  const envPath = resolveUserPath(options.env || resolveEnvFilePath(configPath));

  out.header("ANT Setup Wizard");
  out.newline();
  out.keyValue("Config path", configPath);
  out.keyValue("Env path", envPath);
  out.newline();

  if (configExists(configPath) && !options.force) {
    out.warn(`Config already exists: ${configPath}`);
    out.info("Re-run with --force to overwrite.");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string, defaultValue?: string): Promise<string> => {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      rl.question(chalk.cyan(prompt), (answer) => {
        resolve(answer.trim() || defaultValue || "");
      });
    });
  };

  const askSecret = (question: string, defaultValue?: string): Promise<string> => {
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
      (rl as any).question(chalk.cyan(prompt), { hideEchoBack: true }, (answer: string) => {
        resolve((answer || "").trim() || defaultValue || "");
      });
    });
  };

  const confirm = async (question: string, defaultYes = true): Promise<boolean> => {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await ask(`${question} ${suffix}`, "");
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith("y");
  };

  try {
    const base = createBaseConfig();

    out.section("Step 1: Workspace + State");
    base.workspaceDir = await ask("Workspace directory", ".");

    const useGlobalState = await confirm("Store runtime state in ~/.ant? (recommended)", true);
    if (useGlobalState) {
      (base as any).stateDir = "~/.ant";
    } else {
      delete (base as any).stateDir;
    }

    out.newline();
    out.section("Step 2: Provider");
    out.info("Choose how ant will access language models.");
    out.newline();

    const hasCliTools = detectCliTools();
    const hasLmStudio = await detectLmStudio();
    if (hasLmStudio) out.info("Detected LM Studio at http://localhost:1234/v1");
    if (hasCliTools.length > 0) out.info(`Detected CLI tools: ${hasCliTools.join(", ")}`);

    out.listItem("1. Local LLM (LM Studio / OpenAI-compatible)");
    out.listItem("2. OpenAI API (cloud)");
    out.listItem("3. CLI tool (codex/copilot/claude/kimi)");
    out.newline();

    const providerChoiceRaw = await ask("Select provider type (1-3)", hasLmStudio ? "1" : hasCliTools.length ? "3" : "2");
    const providerChoice: ProviderChoice =
      providerChoiceRaw === "2" ? "openai" : providerChoiceRaw === "3" ? "cli" : "lmstudio";

    const envUpdates: Record<string, string | null> = {};

    const lmstudioDefaults = {
      baseUrl: "http://localhost:1234/v1",
      model: "local-model",
      embeddingsModel: "text-embedding-nomic-embed-text-v1.5",
    };

    if (providerChoice === "lmstudio") {
      const baseUrl = await ask("LM Studio baseUrl", lmstudioDefaults.baseUrl);
      const model = await ask("Chat model", lmstudioDefaults.model);
      const embeddingsModel = await ask("Embeddings model", lmstudioDefaults.embeddingsModel);
      setProviderConfig({
        base,
        choice: "lmstudio",
        lmstudio: { baseUrl, model, embeddingsModel },
        useLmStudioForEmbeddings: true,
      });
    }

    if (providerChoice === "openai") {
      out.warn("OpenAI API requires OPENAI_API_KEY in .env.");
      const model = await ask("Chat model", "gpt-4.1-mini");
      const embeddingsModel = await ask("Embeddings model", "text-embedding-3-small");
      const key = await askSecret("OPENAI_API_KEY (leave blank to skip)", "");
      if (key) envUpdates.OPENAI_API_KEY = key;
      setProviderConfig({
        base,
        choice: "openai",
        openai: { model, embeddingsModel },
        useLmStudioForEmbeddings: false,
      });
    }

    if (providerChoice === "cli") {
      const defaultTool = hasCliTools[0] || "copilot";
      const toolRaw = await ask("CLI tool (codex/copilot/claude/kimi)", defaultTool);
      const tool = (["codex", "copilot", "claude", "kimi"] as const).includes(toolRaw as any)
        ? (toolRaw as any)
        : defaultTool;
      const model = await ask("Model name", tool === "copilot" ? "gpt-5-mini" : "gpt-5.2-codex");

      const useLmStudioForEmbeddings = await confirm("Use LM Studio for embeddings/memory?", true);
      let lmstudio: { baseUrl: string; model: string; embeddingsModel: string } | undefined;
      if (useLmStudioForEmbeddings) {
        const baseUrl = await ask("LM Studio baseUrl", lmstudioDefaults.baseUrl);
        const embeddingsModel = await ask("Embeddings model", lmstudioDefaults.embeddingsModel);
        lmstudio = { baseUrl, model: "local-model", embeddingsModel };
      }

      setProviderConfig({
        base,
        choice: "cli",
        cli: { tool, model },
        lmstudio,
        useLmStudioForEmbeddings,
      });
    }

    out.newline();
    out.section("Step 3: Channels");
    const enableTelegram = await confirm("Enable Telegram channel?", false);
    if (enableTelegram) {
      (base as any).telegram = {
        ...(base as any).telegram,
        enabled: true,
        mode: "polling",
        dmPolicy: "pairing",
      };
      const token = await askSecret("ANT_TELEGRAM_BOT_TOKEN (leave blank to skip)", "");
      if (token) envUpdates.ANT_TELEGRAM_BOT_TOKEN = token;
    }

    const enableWhatsApp = await confirm("Enable WhatsApp channel?", true);
    if (!enableWhatsApp) {
      envUpdates.ANT_WHATSAPP_ENABLED = "false";
    }

    out.newline();
    out.section("Configuration Preview");
    const validate = validateConfigObject(base);
    if (!validate.ok) {
      out.warn("Generated config has validation errors:");
      for (const err of validate.errors || []) {
        out.listItem(`${err.path}: ${err.message}`);
      }
      out.newline();
      out.warn("Fix the issues above or edit the config after saving.");
    }

    console.log(chalk.dim(JSON.stringify(base, null, 2)));

    out.newline();
    if (!(await confirm("Save this configuration?", true))) {
      out.info("Configuration not saved.");
      return;
    }

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(base, null, 2), "utf-8");
    out.success(`Wrote config: ${configPath}`);

    if (Object.keys(envUpdates).length > 0) {
      const res = await applyEnvUpdates(envPath, envUpdates);
      if (!res.ok) {
        out.warn(`Failed to update .env: ${res.error}`);
      } else {
        out.success(`Updated env: ${res.path}`);
      }
    } else {
      out.info("No env changes requested (secrets left blank).");
    }

    out.newline();
    out.info("Next steps:");
    out.listItem("Run `ant doctor` to verify your setup");
    out.listItem("Run `ant start` (or `ant run`) to start the runtime");
    out.listItem("Use the UI: Genetic Code -> Secrets to update tokens later");
  } finally {
    rl.close();
  }
}

export default onboard;

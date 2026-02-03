/**
 * Onboard Command - Setup wizard inspired by OpenClaw
 */

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { execSync } from "node:child_process";
import chalk from "chalk";
import { OutputFormatter } from "./output-formatter.js";

export interface OnboardOptions {
  config?: string;
  force?: boolean;
  quiet?: boolean;
}

interface OnboardConfig {
  workspaceDir: string;
  provider: {
    type: "openai" | "cli";
    cliProvider?: "codex" | "copilot" | "claude" | "kimi";
    baseUrl?: string;
    model: string;
  };
  memory: {
    enabled: boolean;
    sqlitePath: string;
    embeddingsModel: string;
  };
  whatsapp: {
    sessionDir: string;
    respondToGroups: boolean;
    mentionOnly: boolean;
  };
  ui: {
    enabled: boolean;
    port: number;
  };
}

/**
 * Interactive setup wizard
 */
export async function onboard(options: OnboardOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  out.header("ANT Setup Wizard");
  out.newline();
  out.info("This wizard will help you configure ANT.");
  out.info("Press Ctrl+C at any time to cancel.");
  out.newline();

  // Check for existing config
  const configPath = options.config || "ant.config.json";
  try {
    await fs.access(configPath);
    if (!options.force) {
      out.warn(`Configuration file already exists: ${configPath}`);
      out.info("Use --force to overwrite or specify a different path with --config.");
      return;
    }
  } catch {
    // Config doesn't exist, good to proceed
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

  const confirm = async (question: string, defaultYes = true): Promise<boolean> => {
    const suffix = defaultYes ? "[Y/n]" : "[y/N]";
    const answer = await ask(`${question} ${suffix}`, "");
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith("y");
  };

  const config: OnboardConfig = {
    workspaceDir: ".",
    provider: {
      type: "openai",
      model: "gpt-4",
    },
    memory: {
      enabled: true,
      sqlitePath: ".ant/memory.sqlite",
      embeddingsModel: "text-embedding-ada-002",
    },
    whatsapp: {
      sessionDir: ".ant/whatsapp",
      respondToGroups: false,
      mentionOnly: true,
    },
    ui: {
      enabled: true,
      port: 5117,
    },
  };

  try {
    // Step 1: Workspace
    out.section("Step 1: Workspace");
    config.workspaceDir = await ask("Workspace directory", ".");

    // Step 2: LLM Provider
    out.newline();
    out.section("Step 2: LLM Provider");
    out.info("Choose how ANT will access language models.");
    out.newline();

    const hasCliTools = detectCliTools();
    const hasLmStudio = await detectLmStudio();

    out.listItem("1. Local LLM (LM Studio, Ollama, etc.)");
    out.listItem("2. CLI Tool (codex, copilot, claude)");
    out.listItem("3. OpenAI API");
    out.newline();

    const providerChoice = await ask("Select provider type (1-3)", hasLmStudio ? "1" : hasCliTools.length > 0 ? "2" : "1");

    switch (providerChoice) {
      case "1":
        config.provider.type = "openai";
        config.provider.baseUrl = await ask("LLM server URL", "http://localhost:1234/v1");
        config.provider.model = await ask("Model name", "local-model");
        break;

      case "2":
        config.provider.type = "cli";
        if (hasCliTools.length > 0) {
          out.info(`Detected: ${hasCliTools.join(", ")}`);
          config.provider.cliProvider = hasCliTools[0] as "codex" | "copilot" | "claude";
        }
        const cliTool = await ask("CLI tool (codex/copilot/claude)", config.provider.cliProvider || "codex");
        config.provider.cliProvider = cliTool as "codex" | "copilot" | "claude";
        config.provider.model = await ask("Model name", "gpt-4");
        break;

      case "3":
        config.provider.type = "openai";
        config.provider.baseUrl = "https://api.openai.com/v1";
        out.warn("You'll need to set OPENAI_API_KEY environment variable.");
        config.provider.model = await ask("Model name", "gpt-4");
        break;
    }

    // Step 3: Memory
    out.newline();
    out.section("Step 3: Memory");
    config.memory.enabled = await confirm("Enable memory (semantic search)?");
    if (config.memory.enabled) {
      config.memory.sqlitePath = await ask("Memory database path", ".ant/memory.sqlite");
      config.memory.embeddingsModel = await ask("Embeddings model", "text-embedding-ada-002");
    }

    // Step 4: WhatsApp
    out.newline();
    out.section("Step 4: WhatsApp");
    const enableWhatsApp = await confirm("Configure WhatsApp integration?");
    if (enableWhatsApp) {
      config.whatsapp.sessionDir = await ask("WhatsApp session directory", ".ant/whatsapp");
      config.whatsapp.respondToGroups = await confirm("Respond to group messages?", false);
      if (config.whatsapp.respondToGroups) {
        config.whatsapp.mentionOnly = await confirm("Only respond when mentioned?", true);
      }
    }

    // Step 5: Web UI
    out.newline();
    out.section("Step 5: Web UI");
    config.ui.enabled = await confirm("Enable web UI?");
    if (config.ui.enabled) {
      config.ui.port = parseInt(await ask("UI port", "5117"));
    }

    // Generate config
    out.newline();
    out.section("Configuration Preview");

    const finalConfig = generateConfig(config);
    console.log(chalk.dim(JSON.stringify(finalConfig, null, 2)));

    out.newline();
    if (await confirm("Save this configuration?")) {
      await fs.writeFile(configPath, JSON.stringify(finalConfig, null, 2), "utf-8");
      out.newline();
      out.success(`Configuration saved to ${configPath}`);
      out.newline();
      out.info("Next steps:");
      out.listItem("Run 'ant doctor' to verify your setup");
      out.listItem("Run 'ant start' to start the agent");
    } else {
      out.info("Configuration not saved.");
    }
  } finally {
    rl.close();
  }
}

/**
 * Detect available CLI tools
 */
function detectCliTools(): string[] {
  const tools: string[] = [];
  for (const tool of ["codex", "copilot", "claude"]) {
    try {
      execSync(`which ${tool}`, { stdio: "ignore" });
      tools.push(tool);
    } catch {
      // Not found
    }
  }
  return tools;
}

/**
 * Detect if LM Studio is running
 */
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

/**
 * Generate final config object
 */
function generateConfig(input: OnboardConfig): Record<string, unknown> {
  const config: Record<string, unknown> = {
    workspaceDir: input.workspaceDir,
    provider: {
      type: input.provider.type,
      model: input.provider.model,
    },
    memory: {
      enabled: input.memory.enabled,
      sqlitePath: input.memory.sqlitePath,
      embeddingsModel: input.memory.embeddingsModel,
    },
    whatsapp: {
      sessionDir: input.whatsapp.sessionDir,
      respondToGroups: input.whatsapp.respondToGroups,
      mentionOnly: input.whatsapp.mentionOnly,
    },
    ui: {
      enabled: input.ui.enabled,
      port: input.ui.port,
    },
  };

  if (input.provider.type === "openai" && input.provider.baseUrl) {
    (config.provider as Record<string, unknown>).baseUrl = input.provider.baseUrl;
  }

  if (input.provider.type === "cli" && input.provider.cliProvider) {
    (config.provider as Record<string, unknown>).cliProvider = input.provider.cliProvider;
  }

  return config;
}

export default onboard;

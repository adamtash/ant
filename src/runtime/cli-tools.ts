import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import { runCliCommand, type CliRunResult } from "./cli-runner.js";

export type CliProvider = "codex" | "copilot" | "claude";

export type CliToolResult = CliRunResult & {
  output: string;
};

const DEFAULT_ARGS: Record<CliProvider, string[]> = {
  codex: [
    "exec",
    "--output-last-message",
    "{output}",
    "--color",
    "never",
    "--skip-git-repo-check",
    "-",
  ],
  copilot: ["-p", "{prompt}", "--silent", "--no-color", "--allow-all-tools"],
  claude: ["--print", "--output-format", "text", "--permission-mode", "dontAsk", "{prompt}"],
};

export async function runCliProvider(params: {
  cfg: AntConfig;
  provider: CliProvider;
  prompt: string;
}): Promise<CliToolResult> {
  const providerCfg = params.cfg.cliTools.providers[params.provider];
  const timeoutMs = params.cfg.cliTools.timeoutMs;
  const argsTemplate = providerCfg.args.length > 0 ? providerCfg.args : DEFAULT_ARGS[params.provider];

  const workingDir = params.cfg.resolved.workspaceDir;
  const outputDir = path.join(params.cfg.resolved.stateDir, "cli-tools");
  await fsPromises.mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `${params.provider}-${Date.now()}.txt`);

  let args = argsTemplate.map((arg) =>
    arg
      .replaceAll("{prompt}", params.prompt)
      .replaceAll("{output}", outputFile),
  );

  if (params.cfg.cliTools.mcp.enabled) {
    args = await maybeInjectMcpArgs(params.cfg, params.provider, args);
  }

  const useStdin = argsTemplate.some((arg) => arg === "-" || arg === "{stdin}");
  const stdin = useStdin ? params.prompt : undefined;

  const result = await runCliCommand({
    command: providerCfg.command,
    args,
    stdin,
    timeoutMs,
    cwd: workingDir,
  });

  let output = result.stdout;
  if (params.provider === "codex") {
    try {
      const fileOutput = await fsPromises.readFile(outputFile, "utf-8");
      if (fileOutput.trim()) output = fileOutput.trim();
    } catch {
      // ignore
    }
  }

  return {
    ...result,
    output,
  };
}

async function maybeInjectMcpArgs(
  cfg: AntConfig,
  provider: CliProvider,
  args: string[],
): Promise<string[]> {
  if (provider === "codex") return args;
  if (args.some((arg) => arg.startsWith("--mcp-config") || arg.startsWith("--additional-mcp-config"))) {
    return args;
  }
  const configPath = resolveConfigPath(cfg);
  const mcpConfigPath = await writeMcpConfig(cfg, configPath);
  if (provider === "copilot") {
    return [...args, "--additional-mcp-config", `@${mcpConfigPath}`];
  }
  if (provider === "claude") {
    return [...args, "--mcp-config", mcpConfigPath];
  }
  return args;
}

function resolveConfigPath(cfg: AntConfig): string {
  const envPath = process.env.ANT_CONFIG?.trim();
  if (envPath) return envPath;
  return path.join(cfg.resolved.workspaceDir, "ant.config.json");
}

async function writeMcpConfig(cfg: AntConfig, configPath: string): Promise<string> {
  const outputDir = path.join(cfg.resolved.stateDir, "cli-tools");
  await fsPromises.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, "mcp.json");
  const { command, args } = resolveMcpServerCommand(cfg, configPath);
  const payload = {
    mcpServers: {
      ant: {
        command,
        args,
        env: {
          ANT_CONFIG: configPath,
        },
      },
    },
  };
  await fsPromises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
}

function resolveMcpServerCommand(cfg: AntConfig, configPath: string): { command: string; args: string[] } {
  const node = process.execPath;
  const workspaceDir = cfg.resolved.workspaceDir;
  const cliTs = path.join(workspaceDir, "src", "cli.ts");
  const cliJs = path.join(workspaceDir, "dist", "cli.js");
  const useTs = fs.existsSync(cliTs);
  if (useTs) {
    return {
      command: node,
      args: ["--import", "tsx", cliTs, "mcp-server", "-c", configPath],
    };
  }
  return {
    command: node,
    args: [cliJs, "mcp-server", "-c", configPath],
  };
}

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

const DEFAULT_CONFIG_PATH = "ant.config.json";

const ProviderItemSchema = z
  .object({
    type: z.enum(["openai", "cli"]).default("openai"),
    cliProvider: z.enum(["codex", "copilot", "claude"]).default("codex"),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    model: z.string().min(1),
    models: z
      .object({
        chat: z.string().min(1).optional(),
        tools: z.string().min(1).optional(),
        embeddings: z.string().min(1).optional(),
        summary: z.string().min(1).optional(),
        subagent: z.string().min(1).optional(),
      })
      .default({}),
    contextWindow: z.number().int().positive().optional(),
    embeddingsModel: z.string().min(1).optional(),
  })
  .refine(
    (value) => (value.type === "openai" ? Boolean(value.baseUrl?.trim()) : true),
    { message: "providers.items.*.baseUrl is required for openai provider" },
  );

const ProvidersSchema = z.object({
  default: z.string().min(1),
  items: z.record(ProviderItemSchema),
});

type ProvidersOutput = z.infer<typeof ProvidersSchema>;

const RoutingSchema = z
  .object({
    chat: z.string().optional(),
    tools: z.string().optional(),
    embeddings: z.string().optional(),
    summary: z.string().optional(),
    subagent: z.string().optional(),
    parentForCli: z.string().optional(),
  })
  .default({});

type RoutingOutput = z.infer<typeof RoutingSchema>;

const WhatsAppSchema = z.object({
  sessionDir: z.string().min(1),
  respondToGroups: z.boolean().default(false),
  mentionOnly: z.boolean().default(true),
  botName: z.string().optional(),
  respondToSelfOnly: z.boolean().default(false),
  allowSelfMessages: z.boolean().default(true),
  resetOnLogout: z.boolean().default(true),
  typingIndicator: z.boolean().default(true),
  mentionKeywords: z.array(z.string()).default([]),
  ownerJids: z.array(z.string()).default([]),
});

const MemorySchema = z.object({
  enabled: z.boolean().default(true),
  indexSessions: z.boolean().default(true),
  sqlitePath: z.string().min(1),
  embeddingsModel: z.string().min(1),
  sync: z
    .object({
      onSessionStart: z.boolean().default(true),
      onSearch: z.boolean().default(true),
      watch: z.boolean().default(true),
      watchDebounceMs: z.number().int().positive().default(1500),
      intervalMinutes: z.number().int().min(0).default(0),
      sessionsDeltaBytes: z.number().int().positive().default(100_000),
      sessionsDeltaMessages: z.number().int().positive().default(50),
    })
    .default({}),
  chunkChars: z.number().int().positive().default(1600),
  chunkOverlap: z.number().int().min(0).default(200),
  maxResults: z.number().int().positive().default(6),
  minScore: z.number().min(0).max(1).default(0.35),
});

const AgentSchema = z.object({
  systemPrompt: z.string().optional(),
  maxHistoryTokens: z.number().int().positive().default(40_000),
  temperature: z.number().min(0).max(2).default(0.2),
});

const SubagentsSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(300_000),
  archiveAfterMinutes: z.number().int().positive().default(60),
});

const CliToolProviderSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
});

const CliToolsSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(120_000),
  mcp: z
    .object({
      enabled: z.boolean().default(true),
      tools: z.array(z.string()).default(["memory_search", "memory_get"]),
    })
    .default({}),
  providers: z
    .object({
      codex: CliToolProviderSchema.default({ command: "codex", args: [] }),
      copilot: CliToolProviderSchema.default({ command: "copilot", args: [] }),
      claude: CliToolProviderSchema.default({ command: "claude", args: [] }),
    })
    .default({
      codex: { command: "codex", args: [] },
      copilot: { command: "copilot", args: [] },
      claude: { command: "claude", args: [] },
    }),
});

const QueueSchema = z.object({
  warnAfterMs: z.number().int().positive().default(2_000),
});

const LoggingSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  filePath: z.string().optional(),
  fileLevel: z.enum(["trace", "debug", "info", "warn", "error"]).optional(),
});

const RuntimeSchema = z
  .object({
    restart: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
      })
      .optional(),
  })
  .default({});

const ConfigSchema = z.object({
  workspaceDir: z.string().default("."),
  stateDir: z.string().optional(),
  provider: ProviderItemSchema.optional(),
  providers: ProvidersSchema.optional(),
  routing: RoutingSchema.optional(),
  whatsapp: WhatsAppSchema,
  memory: MemorySchema,
  agent: AgentSchema.default({}),
  subagents: SubagentsSchema.default({}),
  cliTools: CliToolsSchema.default({}),
  queue: QueueSchema.default({}),
  logging: LoggingSchema.default({}),
  runtime: RuntimeSchema.default({}),
});

export type AntConfig = z.infer<typeof ConfigSchema> & {
  resolved: {
    workspaceDir: string;
    stateDir: string;
    memorySqlitePath: string;
    whatsappSessionDir: string;
    providerEmbeddingsModel: string;
    providers: ProvidersOutput;
    routing: RoutingOutput;
    logFilePath: string;
    logFileLevel: string;
  };
};

export async function loadConfig(explicitPath?: string): Promise<AntConfig> {
  const configPath = resolveConfigPath(explicitPath);
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  const base = ConfigSchema.parse(parsed);
  return resolveConfig(base);
}

export function resolveConfigPath(explicitPath?: string): string {
  const envPath = process.env.ANT_CONFIG?.trim();
  const pathToUse = explicitPath?.trim() || envPath || DEFAULT_CONFIG_PATH;
  return path.resolve(pathToUse);
}

function resolveConfig(base: z.infer<typeof ConfigSchema>): AntConfig {
  const workspaceDir = resolveUserPath(base.workspaceDir);
  const stateDir = resolveUserPath(
    base.stateDir?.trim() || path.join(workspaceDir, ".ant"),
    workspaceDir,
  );
  const memorySqlitePath = resolveUserPath(base.memory.sqlitePath, workspaceDir);
  const whatsappSessionDir = resolveUserPath(base.whatsapp.sessionDir, workspaceDir);
  const logFilePath = resolveUserPath(
    base.logging.filePath?.trim() || path.join(stateDir, "ant.log"),
    workspaceDir,
  );
  const logFileLevel = base.logging.fileLevel?.trim() || base.logging.level;
  const providers = normalizeProviders(base);
  const routing = normalizeRouting(base, providers);
  const defaultProvider = providers.items[providers.default];
  const providerEmbeddingsModel =
    defaultProvider?.embeddingsModel?.trim() || base.memory.embeddingsModel;

  return {
    ...base,
    resolved: {
      workspaceDir,
      stateDir,
      memorySqlitePath,
      whatsappSessionDir,
      providerEmbeddingsModel,
      providers,
      routing,
      logFilePath,
      logFileLevel,
    },
  };
}

function normalizeProviders(base: z.infer<typeof ConfigSchema>): ProvidersOutput {
  if (base.providers) return base.providers;
  if (base.provider) {
    return {
      default: "default",
      items: {
        default: base.provider,
      },
    };
  }
  return {
    default: "default",
    items: {
      default: {
        type: "openai",
        cliProvider: "codex",
        baseUrl: "http://localhost:1234/v1",
        model: "unknown",
        models: {},
      },
    },
  };
}

function normalizeRouting(
  base: z.infer<typeof ConfigSchema>,
  providers: ProvidersOutput,
): RoutingOutput {
  const fallback = providers.default;
  const raw = base.routing ?? {};
  return {
    chat: raw.chat ?? fallback,
    tools: raw.tools ?? fallback,
    embeddings: raw.embeddings ?? fallback,
    summary: raw.summary ?? raw.chat ?? fallback,
    subagent: raw.subagent ?? raw.chat ?? fallback,
    parentForCli: raw.parentForCli ?? raw.tools ?? fallback,
  };
}

function resolveUserPath(value: string, baseDir?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  if (baseDir) {
    return path.resolve(baseDir, trimmed);
  }
  return path.resolve(trimmed);
}

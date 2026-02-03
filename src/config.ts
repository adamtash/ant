import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";
import { readProvidersDiscoveredOverlay } from "./config/provider-writer.js";

const DEFAULT_CONFIG_PATH = "ant.config.json";

const ProviderItemSchema = z
  .object({
    type: z.enum(["openai", "cli", "ollama"]).default("openai"),
    cliProvider: z.enum(["codex", "copilot", "claude", "kimi"]).default("codex"),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
    authProfiles: z
      .array(
        z.object({
          apiKey: z.string().min(1),
          label: z.string().optional(),
          cooldownMinutes: z.number().int().positive().optional(),
        })
      )
      .default([]),
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
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    healthCheckTimeoutMs: z.number().int().positive().optional(),
    healthCheckCacheTtlMinutes: z.number().int().positive().optional(),
  })
  .refine(
    (value) => (value.type === "openai" ? Boolean(value.baseUrl?.trim()) : true),
    { message: "providers.items.*.baseUrl is required for openai provider" },
  );

const ProvidersDiscoverySchema = z
  .object({
    enabled: z.boolean().default(false),
    researchIntervalHours: z.number().int().positive().default(24),
    healthCheckIntervalMinutes: z.number().int().positive().default(15),
    minBackupProviders: z.number().int().min(0).default(2),
    trustSources: z.array(z.string()).default([]),
  })
  .default({});

const ProvidersLocalSchema = z
  .object({
    enabled: z.boolean().default(true),
    preferFastModels: z.boolean().default(true),
    autoDownloadModels: z.boolean().default(false),
    ollama: z
      .object({
        enabled: z.boolean().default(true),
        endpoint: z.string().default("http://localhost:11434"),
        fastModels: z
          .array(z.string())
          .default(["llama3.2:1b", "qwen2.5:0.5b", "phi3:mini", "gemma2:2b"]),
      })
      .default({}),
    lmstudio: z
      .object({
        enabled: z.boolean().default(true),
        endpoint: z.string().default("http://localhost:1234/v1"),
        fastModels: z
          .array(z.string())
          .default([
            "lmstudio-community/Llama-3.2-1B-Instruct-GGUF",
            "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
          ]),
      })
      .default({}),
  })
  .default({});

const ProvidersSchema = z.object({
  default: z.string().min(1),
  items: z.record(ProviderItemSchema),
  fallbackChain: z.array(z.string()).optional().default([]),
  discovery: ProvidersDiscoverySchema.optional().default({}),
  local: ProvidersLocalSchema.optional().default({}),
});

type ProvidersOutput = z.infer<typeof ProvidersSchema>;

const RoutingTierSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1).optional(),
    maxLatencyMs: z.number().int().positive().optional(),
    fallbackFromFast: z.boolean().optional(),
  })
  .strict();

const RoutingTiersSchema = z
  .object({
    fast: RoutingTierSchema.optional(),
    quality: RoutingTierSchema.optional(),
    background: RoutingTierSchema.optional(),
    backgroundImportant: RoutingTierSchema.optional(),
    embeddings: RoutingTierSchema.optional(),
    summarizer: RoutingTierSchema.optional(),
    maintenance: RoutingTierSchema.optional(),
  })
  .default({});

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
  startupMessage: z.string().optional(),
  startupRecipients: z.array(z.string()).default([]),
});

const TelegramSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Bot API mode: long polling (local) or webhook (public). */
    mode: z.enum(["polling", "webhook"]).default("polling"),
    botToken: z.string().optional(),
    /** Secure-by-default DM access control. */
    dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).default("pairing"),
    webhook: z
      .object({
        /** Public base URL (e.g. https://example.com) used to register the webhook with Telegram. */
        publicUrl: z.string().min(1).optional(),
        /** Path on our gateway server to receive webhook updates. */
        path: z.string().min(1).default("/api/telegram/webhook"),
        /** Optional Telegram secret token (checked via X-Telegram-Bot-Api-Secret-Token). */
        secretToken: z.string().min(1).optional(),
      })
      .default({}),
    respondToGroups: z.boolean().default(false),
    mentionOnly: z.boolean().default(true),
    botName: z.string().optional(),
    typingIndicator: z.boolean().default(true),
    linkPreview: z.boolean().default(true),
    /** Download inbound media to the state dir and attach local paths to messages. */
    downloadMedia: z.boolean().default(false),
    /** Hard limit for inbound media downloads (bytes). */
    maxInboundMediaBytes: z.number().int().positive().default(20_000_000),
    mentionKeywords: z.array(z.string()).default([]),
    allowFrom: z.array(z.string()).default([]),
  })
  .default({});

const MemorySchema = z.object({
  enabled: z.boolean().default(true),
  indexSessions: z.boolean().default(true),
  sqlitePath: z.string().min(1),
  embeddingsModel: z.string().min(1),
  provider: z
    .object({
      embeddings: z.enum(["auto", "local", "openai", "gemini"]).default("auto"),
      fallback: z.array(z.enum(["local", "openai", "gemini"])).default(["openai"]),
      local: z
        .object({
          baseUrl: z.string().default("http://localhost:1234/v1"),
          model: z.string().optional(),
        })
        .default({}),
      openai: z
        .object({
          baseUrl: z.string().optional(),
          apiKey: z.string().optional(),
          model: z.string().optional(),
        })
        .default({}),
      gemini: z
        .object({
          apiKey: z.string().optional(),
          model: z.string().optional(),
        })
        .default({}),
      batch: z
        .object({
          enabled: z.boolean().default(true),
          minChunks: z.number().int().positive().default(50),
          maxTokens: z.number().int().positive().default(8000),
          concurrency: z.number().int().positive().default(4),
          pollIntervalMs: z.number().int().positive().default(2000),
          timeoutMinutes: z.number().int().positive().default(60),
        })
        .default({}),
    })
    .default({}),
  chunking: z
    .object({
      tokens: z.number().int().positive().default(400),
      overlap: z.number().int().min(0).default(80),
    })
    .default({}),
  sources: z.array(z.enum(["memory", "sessions"])).default(["memory", "sessions"]),
  sync: z
    .object({
      onSessionStart: z.boolean().default(true),
      onSearch: z.boolean().default(true),
      watch: z.boolean().default(true),
      watchDebounceMs: z.number().int().positive().default(1500),
      intervalMinutes: z.number().int().min(0).default(60),
      sessions: z
        .object({
          deltaBytes: z.number().int().positive().default(100_000),
          deltaMessages: z.number().int().positive().default(50),
        })
        .default({}),
    })
    .default({}),
  query: z
    .object({
      maxResults: z.number().int().positive().default(6),
      minScore: z.number().min(0).max(1).default(0.35),
      hybrid: z
        .object({
          enabled: z.boolean().default(true),
          vectorWeight: z.number().min(0).max(1).default(0.7),
          textWeight: z.number().min(0).max(1).default(0.3),
          candidateMultiplier: z.number().min(1).default(4),
        })
        .default({}),
    })
    .default({}),
  cache: z
    .object({
      enabled: z.boolean().default(true),
      maxEntries: z.number().int().positive().default(1000),
    })
    .default({}),
});

const RoutingSchema = z
  .object({
    chat: z.string().optional(),
    tools: z.string().optional(),
    embeddings: z.string().optional(),
    summary: z.string().optional(),
    subagent: z.string().optional(),
    parentForCli: z.string().optional(),
    tiers: RoutingTiersSchema.optional(),
  })
  .default({});

type RoutingOutput = z.infer<typeof RoutingSchema>;

const AgentSchema = z.object({
  systemPrompt: z.string().optional(),
  maxHistoryTokens: z.number().int().positive().default(40_000),
  temperature: z.number().min(0).max(2).default(0.2),
  maxToolIterations: z.number().int().positive().default(6),
  toolLoop: z
    .object({
      timeoutPerIterationMs: z.number().int().positive().default(30_000),
      timeoutPerToolMs: z.number().int().positive().default(30_000),
      contextWindowThresholdPercent: z.number().int().min(1).max(100).default(50), // Proactive compaction
    })
    .default({}),
  compaction: z
    .object({
      enabled: z.boolean().default(true),
      thresholdPercent: z.number().int().min(1).max(100).default(75),
      maxSummaryTokens: z.number().int().positive().default(600),
      minRecentMessages: z.number().int().positive().default(8),
    })
    .default({}),
  thinking: z
    .object({
      level: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).default("off"),
    })
    .default({}),
  toolPolicy: z.string().optional(),
  toolResultGuard: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({}),
});

const MainAgentSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.number().int().positive().default(60000),
  dutiesFile: z.string().default("AGENT_DUTIES.md"),
  logFile: z.string().default(".ant/AGENT_LOG.md"),
});

const SubagentsSchema = z.object({
  enabled: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(300_000),
  archiveAfterMinutes: z.number().int().positive().default(60),
});

const AgentExecutionSchema = z
  .object({
    tasks: z
      .object({
        registry: z
          .object({
            dir: z.string().default("./.ant/tasks"),
            cacheTtlMs: z.number().int().positive().default(45_000),
            maxHistorySize: z.number().int().positive().default(1000),
          })
          .default({}),
        defaults: z
          .object({
            timeoutMs: z.number().int().positive().default(120_000),
            maxRetries: z.number().int().positive().default(3),
            retryBackoffMs: z.number().int().positive().default(1000),
            retryBackoffMultiplier: z.number().int().positive().default(2),
            retryBackoffCap: z.number().int().positive().default(60_000),
          })
          .default({}),
      })
      .default({}),
    lanes: z
      .object({
        main: z
          .object({
            maxConcurrent: z.number().int().positive().default(1),
          })
          .default({}),
        autonomous: z
          .object({
            maxConcurrent: z.number().int().positive().default(5),
          })
          .default({}),
        maintenance: z
          .object({
            maxConcurrent: z.number().int().positive().default(1),
          })
          .default({}),
      })
      .default({}),
    subagents: z
      .object({
        timeoutMs: z.number().int().positive().default(120_000),
        maxRetries: z.number().int().positive().default(2),
      })
      .default({}),
    monitoring: z
      .object({
        timeoutCheckIntervalMs: z.number().int().positive().default(1000),
        statusBroadcastDebounceMs: z.number().int().positive().default(200),
      })
      .default({}),
  })
  .default({});

const GatewaySchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().positive().default(18789),
  host: z.string().min(1).default("127.0.0.1"),
});

const SchedulerSchema = z
  .object({
    enabled: z.boolean().default(false),
    storePath: z.string().min(1).optional(),
    timezone: z.string().min(1).default("UTC"),
  })
  .default({});

const MonitoringSchema = z
  .object({
    enabled: z.boolean().default(true),
    retentionDays: z.number().int().positive().default(30),
    alertChannels: z
      .array(z.enum(["console", "file", "whatsapp", "webhook"]))
      .default(["console"]),
    criticalErrorThreshold: z.number().int().positive().default(10),
  })
  .default({});

const CliToolProviderSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive().optional(),
});

const KimiProviderSchema = z.object({
  type: z.literal("cli"),
  cliProvider: z.literal("kimi"),
  model: z.string().default("kimi-k2"),
  command: z.string().default("kimi"),
  args: z.array(z.string()).default(["--yolo"]),
  timeoutMs: z.number().int().positive().optional(),
});

const CliToolsSchema = z.object({
  enabled: z.boolean().default(true),
  allowToolCalls: z.boolean().default(false),
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
      kimi: CliToolProviderSchema.default({ command: "kimi", args: ["--yolo"] }),
    })
    .default({
      codex: { command: "codex", args: [] },
      copilot: { command: "copilot", args: [] },
      claude: { command: "claude", args: [] },
      kimi: { command: "kimi", args: ["--yolo"] },
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
    start: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
      })
      .optional(),
  })
  .default({});

const UiSchema = z
  .object({
    enabled: z.boolean().default(true),
    port: z.number().int().positive().default(5117),
    host: z.string().min(1).default("127.0.0.1"),
    autoOpen: z.boolean().default(true),
    openUrl: z.string().optional(),
    staticDir: z.string().default("ui/dist"),
  })
  .default({});

const BrowserProfileSchema = z.object({
  cdpUrl: z.string().optional(),
});

const BrowserSchema = z
  .object({
    enabled: z.boolean().default(true),
    headless: z.boolean().default(true),
    defaultProfile: z.string().default("default"),
    profiles: z.record(BrowserProfileSchema).default({}),
    proxyBaseUrl: z.string().optional(),
  })
  .default({});

const ToolPolicySchema = z
  .object({
    allowedGroups: z.array(z.string()).default([]),
    deniedGroups: z.array(z.string()).default([]),
    allowedTools: z.array(z.string()).default([]),
    deniedTools: z.array(z.string()).default([]),
    allowedChannels: z.array(z.enum(["whatsapp", "cli", "web", "telegram", "discord"])).default([]),
    deniedChannels: z.array(z.enum(["whatsapp", "cli", "web", "telegram", "discord"])).default([]),
    allowedModels: z.array(z.string()).default([]),
    deniedModels: z.array(z.string()).default([]),
    allowedAudiences: z.array(z.string()).default([]),
    deniedAudiences: z.array(z.string()).default([]),
  })
  .default({});

const ToolPoliciesSchema = z.record(ToolPolicySchema).default({});

const ConfigSchema = z.object({
  workspaceDir: z.string().default("."),
  stateDir: z.string().optional(),
  provider: ProviderItemSchema.optional(),
  providers: ProvidersSchema.optional(),
  routing: RoutingSchema.optional(),
  browser: BrowserSchema.default({}),
  ui: UiSchema.default({}),
  whatsapp: WhatsAppSchema,
  telegram: TelegramSchema,
  memory: MemorySchema,
  agent: AgentSchema.default({}),
  toolPolicies: ToolPoliciesSchema,
  mainAgent: MainAgentSchema.default({}),
  subagents: SubagentsSchema.default({}),
  agentExecution: AgentExecutionSchema.default({}),
  gateway: GatewaySchema.default({}),
  cliTools: CliToolsSchema.default({}),
  scheduler: SchedulerSchema.default({}),
  monitoring: MonitoringSchema.default({}),
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
    telegramStateDir: string;
    providerEmbeddingsModel: string;
    providers: ProvidersOutput;
    routing: RoutingOutput;
    logFilePath: string;
    logFileLevel: string;
    configPath: string;
    uiStaticDir: string;
  };
};

export async function loadConfig(explicitPath?: string): Promise<AntConfig> {
  const configPath = resolveConfigPath(explicitPath);
  const raw = await fs.readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw);
  const withEnv = applyEnvOverrides(parsed);
  const base = ConfigSchema.parse(withEnv);
  const resolved = resolveConfig(base, configPath);
  const overlayResult = await readProvidersDiscoveredOverlay(resolved.resolved.stateDir);
  if (!overlayResult.ok || !overlayResult.overlay) return resolved;

  const overlay = overlayResult.overlay;
  const baseProviders = resolved.resolved.providers;
  const mergedItems: Record<string, z.infer<typeof ProviderItemSchema>> = {
    ...(baseProviders.items as Record<string, z.infer<typeof ProviderItemSchema>>),
  };

  const candidates: Array<{
    id: string;
    kind: "local" | "remote";
    reliabilityScore: number;
  }> = [];

  for (const [id, record] of Object.entries(overlay.providers)) {
    if (!id) continue;
    const parsedConfig = ProviderItemSchema.safeParse(record.config);
    if (!parsedConfig.success) {
      if (id in mergedItems) {
        candidates.push({
          id,
          kind: record.kind,
          reliabilityScore: typeof record.reliabilityScore === "number" ? record.reliabilityScore : 0,
        });
      }
      continue;
    }

    if (!(id in mergedItems)) {
      mergedItems[id] = parsedConfig.data;
    }

    candidates.push({
      id,
      kind: record.kind,
      reliabilityScore: typeof record.reliabilityScore === "number" ? record.reliabilityScore : 0,
    });
  }

  if (candidates.length === 0) return resolved;

  const localIds = candidates
    .filter((p) => p.kind === "local")
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore || a.id.localeCompare(b.id))
    .map((p) => p.id);
  const remoteIds = candidates
    .filter((p) => p.kind === "remote")
    .sort((a, b) => b.reliabilityScore - a.reliabilityScore || a.id.localeCompare(b.id))
    .map((p) => p.id);
  const discoveredOrder = [...localIds, ...remoteIds];

  const mergedFallbackChain = Array.from(
    new Set([...(baseProviders.fallbackChain ?? []), ...discoveredOrder])
  );

  const mergedProviders = {
    ...baseProviders,
    items: mergedItems,
    fallbackChain: mergedFallbackChain,
  };

  return {
    ...resolved,
    resolved: {
      ...resolved.resolved,
      providers: mergedProviders,
    },
  };
}

export async function saveConfig(config: unknown, explicitPath?: string): Promise<void> {
  const configPath = resolveConfigPath(explicitPath);
  // specific validation could be done here, or just writing JSON
  // We do a partial parse/validation to ensure structure
  const parsed = ConfigSchema.parse(config);
  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2), "utf-8");
}

export function resolveConfigPath(explicitPath?: string): string {
  const envPath = (process.env.ANT_CONFIG_PATH ?? process.env.ANT_CONFIG)?.trim();
  const pathToUse = explicitPath?.trim() || envPath || DEFAULT_CONFIG_PATH;
  return path.resolve(pathToUse);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function applyEnvOverrides(raw: unknown): unknown {
  if (!isPlainObject(raw)) return raw;

  const config: Record<string, unknown> = { ...raw };

  const envStr = (name: string) => {
    const v = (process.env[name] || "").trim();
    return v ? v : undefined;
  };
  const envInt = (name: string) => {
    const v = envStr(name);
    if (!v) return undefined;
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const workspaceDir = envStr("ANT_WORKSPACE_DIR");
  if (workspaceDir) config.workspaceDir = workspaceDir;

  const stateDir = envStr("ANT_STATE_DIR");
  if (stateDir) config.stateDir = stateDir;

  const gatewayPort = envInt("ANT_GATEWAY_PORT");
  const gatewayHost = envStr("ANT_GATEWAY_HOST");
  if (gatewayPort !== undefined || gatewayHost) {
    const gateway = isPlainObject(config.gateway) ? { ...config.gateway } : {};
    if (gatewayPort !== undefined) gateway.port = gatewayPort;
    if (gatewayHost) gateway.host = gatewayHost;
    config.gateway = gateway;
  }

  const uiPort = envInt("ANT_UI_PORT");
  const uiHost = envStr("ANT_UI_HOST");
  if (uiPort !== undefined || uiHost) {
    const ui = isPlainObject(config.ui) ? { ...config.ui } : {};
    if (uiPort !== undefined) ui.port = uiPort;
    if (uiHost) ui.host = uiHost;
    config.ui = ui;
  }

  const logLevel = envStr("ANT_LOG_LEVEL");
  const logFileLevel = envStr("ANT_LOG_FILE_LEVEL");
  const logFilePath = envStr("ANT_LOG_FILE_PATH");
  if (logLevel || logFileLevel || logFilePath) {
    const logging = isPlainObject(config.logging) ? { ...config.logging } : {};
    if (logLevel) logging.level = logLevel;
    if (logFileLevel) logging.fileLevel = logFileLevel;
    if (logFilePath) logging.filePath = logFilePath;
    config.logging = logging;
  }

  const telegramEnabled = envStr("ANT_TELEGRAM_ENABLED");
  const telegramToken = envStr("ANT_TELEGRAM_BOT_TOKEN");
  const telegramMode = envStr("ANT_TELEGRAM_MODE");
  const telegramWebhookPublicUrl = envStr("ANT_TELEGRAM_WEBHOOK_PUBLIC_URL");
  const telegramWebhookPath = envStr("ANT_TELEGRAM_WEBHOOK_PATH");
  const telegramWebhookSecret = envStr("ANT_TELEGRAM_WEBHOOK_SECRET_TOKEN");
  if (
    telegramEnabled ||
    telegramToken ||
    telegramMode ||
    telegramWebhookPublicUrl ||
    telegramWebhookPath ||
    telegramWebhookSecret
  ) {
    const telegram = isPlainObject(config.telegram) ? { ...config.telegram } : {};
    if (telegramEnabled) telegram.enabled = telegramEnabled.toLowerCase() === "true";
    if (telegramToken) telegram.botToken = telegramToken;
    if (telegramMode && (telegramMode === "polling" || telegramMode === "webhook")) telegram.mode = telegramMode;
    if (telegramWebhookPublicUrl || telegramWebhookPath || telegramWebhookSecret) {
      const webhook = isPlainObject((telegram as any).webhook) ? { ...(telegram as any).webhook } : {};
      if (telegramWebhookPublicUrl) webhook.publicUrl = telegramWebhookPublicUrl;
      if (telegramWebhookPath) webhook.path = telegramWebhookPath;
      if (telegramWebhookSecret) webhook.secretToken = telegramWebhookSecret;
      (telegram as any).webhook = webhook;
    }
    config.telegram = telegram;
  }

  return config;
}

function resolveConfig(base: z.infer<typeof ConfigSchema>, configPath: string): AntConfig {
  const workspaceDir = resolveUserPath(base.workspaceDir);
  const stateDir = resolveUserPath(
    base.stateDir?.trim() || path.join(workspaceDir, ".ant"),
    workspaceDir,
  );
  const memorySqlitePath = resolveUserPath(base.memory.sqlitePath, workspaceDir);
  const whatsappSessionDir = resolveUserPath(base.whatsapp.sessionDir, workspaceDir);
  const telegramStateDir = path.join(stateDir, "telegram");
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
  const uiStaticDir = resolveUserPath(base.ui.staticDir, workspaceDir);

  return {
    ...base,
    resolved: {
      workspaceDir,
      stateDir,
      memorySqlitePath,
      whatsappSessionDir,
      telegramStateDir,
      providerEmbeddingsModel,
      providers,
      routing,
      logFilePath,
      logFileLevel,
      configPath,
      uiStaticDir,
    },
  };
}

function normalizeProviders(base: z.infer<typeof ConfigSchema>): ProvidersOutput {
  if (base.providers) return base.providers;
  if (base.provider) {
    return ProvidersSchema.parse({
      default: "default",
      items: {
        default: base.provider,
      },
      fallbackChain: [],
    });
  }
  return ProvidersSchema.parse({
    default: "default",
    items: {
      default: {
        type: "openai",
        cliProvider: "codex",
        baseUrl: "http://localhost:1234/v1",
        model: "unknown",
        models: {},
        authProfiles: [],
      },
    },
    fallbackChain: [],
  });
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
    tiers: raw.tiers ?? {},
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

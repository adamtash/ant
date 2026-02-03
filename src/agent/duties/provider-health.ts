import type { Logger } from "../../log.js";
import type {
  DiscoveredProviderRecord,
  ProvidersDiscoveredOverlay,
} from "../../config/provider-writer.js";
import { OpenAIProvider, OllamaProvider } from "../providers.js";
import type { Message, ProviderType } from "../types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function parseEnvVarReference(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^\$[A-Z0-9_]+$/.test(raw)) return raw.slice(1);
  const braced = raw.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (braced?.[1]) return braced[1];
  const bracedEnv = raw.match(/^\$\{ENV:([A-Z0-9_]+)\}$/);
  if (bracedEnv?.[1]) return bracedEnv[1];
  const envPrefix = raw.match(/^env:([A-Z0-9_]+)$/i);
  if (envPrefix?.[1]) return envPrefix[1].toUpperCase();
  return null;
}

function isLocalBaseUrl(baseUrl: unknown): boolean {
  if (typeof baseUrl !== "string") return false;
  const trimmed = baseUrl.trim();
  if (!trimmed) return false;
  return (
    trimmed.includes("localhost") ||
    trimmed.includes("127.0.0.1") ||
    trimmed.includes("0.0.0.0")
  );
}

function coerceProviderType(value: unknown): ProviderType | null {
  if (value === "openai" || value === "ollama" || value === "cli") return value;
  return null;
}

function computeReliabilityScore(params: { ok: boolean; latencyMs?: number }): number {
  if (!params.ok) return 0;
  const latencyMs = typeof params.latencyMs === "number" && Number.isFinite(params.latencyMs) ? params.latencyMs : 0;
  const score = Math.round(100 - latencyMs / 100);
  return Math.max(10, Math.min(100, score));
}

async function verifyProviderChat(params: {
  record: DiscoveredProviderRecord;
  logger: Logger;
  timeoutMs: number;
}): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const cfg = params.record.config;
  const type = coerceProviderType(cfg.type);
  if (!type) return { ok: false, error: "invalid_provider_type" };

  const model = typeof cfg.model === "string" ? cfg.model : "";
  if (!model.trim()) return { ok: false, error: "missing_model" };

  const testMessages: Message[] = [
    { role: "user", content: "Reply with a single word: PONG." },
  ];

  if (type === "ollama") {
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
    if (!baseUrl.trim()) return { ok: false, error: "missing_base_url" };

    const provider = new OllamaProvider({
      id: params.record.id,
      baseUrl,
      model,
      logger: params.logger,
    });

    const started = Date.now();
    try {
      const healthy = await provider.health();
      if (!healthy) return { ok: false, error: "health_failed" };
      await provider.chat(testMessages, { maxTokens: 10, temperature: 0, timeoutMs: params.timeoutMs });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - started };
    }
  }

  if (type === "openai") {
    const baseUrl = typeof cfg.baseUrl === "string" ? cfg.baseUrl : "";
    if (!baseUrl.trim()) return { ok: false, error: "missing_base_url" };

    const apiKeyRaw = typeof cfg.apiKey === "string" ? cfg.apiKey : "";
    const envVar = apiKeyRaw ? parseEnvVarReference(apiKeyRaw) : null;
    const resolvedApiKey =
      envVar && process.env[envVar] ? String(process.env[envVar]) : apiKeyRaw || "not-needed";

    if (!isLocalBaseUrl(baseUrl) && envVar && !process.env[envVar]) {
      return { ok: false, error: `missing_api_key_env:${envVar}` };
    }

    const provider = new OpenAIProvider({
      id: params.record.id,
      baseUrl,
      apiKey: resolvedApiKey,
      model,
      logger: params.logger,
    });

    const started = Date.now();
    try {
      const healthy = await provider.health();
      if (!healthy) return { ok: false, error: "health_failed" };
      await provider.chat(testMessages, { maxTokens: 10, temperature: 0, timeoutMs: params.timeoutMs });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err), latencyMs: Date.now() - started };
    }
  }

  return { ok: false, error: "unsupported_provider_type" };
}

export async function verifyDiscoveredProvider(params: {
  record: DiscoveredProviderRecord;
  logger: Logger;
  timeoutMs?: number;
}): Promise<DiscoveredProviderRecord> {
  const timeoutMs = Math.max(1000, params.timeoutMs ?? 8000);
  const checkedAt = Date.now();
  const result = await verifyProviderChat({ record: params.record, logger: params.logger, timeoutMs });
  const reliabilityScore = computeReliabilityScore({ ok: result.ok, latencyMs: result.latencyMs });
  const consecutiveFailures = result.ok ? 0 : (params.record.consecutiveFailures ?? 0) + 1;

  return {
    ...params.record,
    reliabilityScore,
    consecutiveFailures,
    lastResult: result.ok
      ? { ok: true, checkedAt, ...(result.latencyMs ? { latencyMs: result.latencyMs } : {}) }
      : {
          ok: false,
          checkedAt,
          error: result.error ? result.error.slice(0, 300) : "unknown",
          ...(result.latencyMs ? { latencyMs: result.latencyMs } : {}),
        },
  };
}

export async function runDiscoveredProvidersHealthCheck(params: {
  overlay: ProvidersDiscoveredOverlay;
  logger: Logger;
  maxConsecutiveFailures?: number;
  timeoutMs?: number;
}): Promise<{
  overlay: ProvidersDiscoveredOverlay;
  removedIds: string[];
  updatedIds: string[];
}> {
  const maxFailures = params.maxConsecutiveFailures ?? 3;
  const removedIds: string[] = [];
  const updatedIds: string[] = [];

  const providers: Record<string, DiscoveredProviderRecord> = {};

  for (const [id, record] of Object.entries(params.overlay.providers)) {
    if (!record || typeof record !== "object") continue;
    if (!isPlainObject(record.config)) continue;

    const updated = await verifyDiscoveredProvider({
      record: { ...record, id },
      logger: params.logger,
      timeoutMs: params.timeoutMs,
    });

    if ((updated.consecutiveFailures ?? 0) >= maxFailures) {
      removedIds.push(id);
      continue;
    }
    providers[id] = updated;
    updatedIds.push(id);
  }

  return {
    overlay: {
      version: 1,
      generatedAt: Date.now(),
      providers,
    },
    removedIds,
    updatedIds,
  };
}


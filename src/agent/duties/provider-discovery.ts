import type { AntConfig } from "../../config.js";
import type { Logger } from "../../log.js";
import type {
  DiscoveredProviderRecord,
  ProvidersDiscoveredOverlay,
} from "../../config/provider-writer.js";
import { discoverLocalProviders } from "./local-llm-manager.js";
import { verifyDiscoveredProvider } from "./provider-health.js";

type RemoteCandidate = {
  id: string;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  modelEnv: string;
  baseUrlEnv?: string;
};

const REMOTE_CANDIDATES: RemoteCandidate[] = [
  {
    id: "backup:openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    baseUrlEnv: "OPENROUTER_BASE_URL",
  },
  {
    id: "backup:groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    baseUrlEnv: "GROQ_BASE_URL",
  },
  {
    id: "backup:together",
    label: "Together",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    modelEnv: "TOGETHER_MODEL",
    baseUrlEnv: "TOGETHER_BASE_URL",
  },
  {
    id: "backup:mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    baseUrlEnv: "MISTRAL_BASE_URL",
  },
];

function envStr(name: string): string | undefined {
  const value = (process.env[name] || "").trim();
  return value ? value : undefined;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function buildRemoteProviders(now: number): DiscoveredProviderRecord[] {
  const providers: DiscoveredProviderRecord[] = [];
  const globalModel = envStr("ANT_BACKUP_MODEL");

  for (const candidate of REMOTE_CANDIDATES) {
    const apiKey = envStr(candidate.apiKeyEnv);
    if (!apiKey) continue;

    const model = envStr(candidate.modelEnv) || globalModel;
    if (!model) continue;

    const baseUrl = normalizeBaseUrl(envStr(candidate.baseUrlEnv ?? "") || candidate.baseUrl);

    providers.push({
      id: candidate.id,
      kind: "remote",
      source: "env",
      discoveredAt: now,
      reliabilityScore: 0,
      consecutiveFailures: 0,
      config: {
        type: "openai",
        baseUrl,
        apiKey: `\${ENV:${candidate.apiKeyEnv}}`,
        model,
      },
    });
  }

  return providers;
}

export type ProviderDiscoverySummary = {
  added: string[];
  removed: string[];
  kept: string[];
};

export type ProviderDiscoveryResult = {
  overlay: ProvidersDiscoveredOverlay;
  summary: ProviderDiscoverySummary;
  notes: string[];
  runtimes: Awaited<ReturnType<typeof discoverLocalProviders>>["runtimes"];
};

export async function runProviderDiscovery(params: {
  cfg: AntConfig;
  logger: Logger;
  previous?: ProvidersDiscoveredOverlay | null;
  mode?: "scheduled" | "emergency";
  timeoutMsPerProvider?: number;
}): Promise<ProviderDiscoveryResult> {
  const logger = params.logger.child({ component: "provider-discovery" });
  const now = Date.now();
  const notes: string[] = [];

  const local = await discoverLocalProviders({ cfg: params.cfg, logger, now });
  for (const note of local.notes) notes.push(note);

  const remote = buildRemoteProviders(now);
  if (remote.length === 0) {
    notes.push("No remote backup providers discovered from env (missing API key and/or model env vars).");
  }

  const candidates = [...local.providers, ...remote];
  const verified: DiscoveredProviderRecord[] = [];

  const timeoutMs = params.timeoutMsPerProvider ?? 8000;
  for (const record of candidates) {
    const updated = await verifyDiscoveredProvider({ record, logger, timeoutMs });
    if (updated.lastResult?.ok) {
      verified.push(updated);
    } else {
      logger.debug(
        {
          id: updated.id,
          kind: updated.kind,
          error: updated.lastResult && "error" in updated.lastResult ? updated.lastResult.error : undefined,
        },
        "Discovered provider failed verification"
      );
    }
  }

  const providers: Record<string, DiscoveredProviderRecord> = {};
  for (const record of verified) {
    providers[record.id] = record;
  }

  const overlay: ProvidersDiscoveredOverlay = {
    version: 1,
    generatedAt: now,
    providers,
  };

  const prevIds = new Set(Object.keys(params.previous?.providers ?? {}));
  const nextIds = new Set(Object.keys(overlay.providers));
  const added = Array.from(nextIds).filter((id) => !prevIds.has(id)).sort();
  const removed = Array.from(prevIds).filter((id) => !nextIds.has(id)).sort();
  const kept = Array.from(nextIds).filter((id) => prevIds.has(id)).sort();

  if (added.length > 0) notes.push(`Discovered providers added: ${added.join(", ")}`);
  if (removed.length > 0) notes.push(`Discovered providers removed: ${removed.join(", ")}`);
  if (kept.length > 0) notes.push(`Discovered providers retained: ${kept.join(", ")}`);

  return {
    overlay,
    summary: { added, removed, kept },
    notes,
    runtimes: local.runtimes,
  };
}


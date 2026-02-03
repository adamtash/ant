import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../../config.js";
import type { Logger } from "../../log.js";
import type { DiscoveredProviderRecord } from "../../config/provider-writer.js";

type Json = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

async function fetchJson(url: string, timeoutMs: number): Promise<Json> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as Json;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function hasAppInstalled(appPath: string): Promise<boolean> {
  try {
    await fs.stat(appPath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string }
): Promise<{ ok: true; stdout: string; stderr: string } | { ok: false; error: string; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf-8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf-8");
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: "timeout", stdout, stderr });
    }, opts.timeoutMs);
    timeout.unref();
    child.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err), stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ ok: true, stdout, stderr });
      } else {
        resolve({ ok: false, error: `exit_${code ?? "unknown"}`, stdout, stderr });
      }
    });
  });
}

function pickPreferredModel(params: {
  available: string[];
  preferred: string[];
  preferFast: boolean;
}): string | undefined {
  if (params.available.length === 0) return undefined;
  if (params.preferFast) {
    const set = new Set(params.available);
    for (const candidate of params.preferred) {
      if (set.has(candidate)) return candidate;
    }
  }
  return params.available[0];
}

export type LocalLlmRuntimeStatus = {
  reachable: boolean;
  installed?: boolean;
  endpoint: string;
  models: string[];
  selectedModel?: string;
  error?: string;
};

export type LocalLlmDiscoveryResult = {
  providers: DiscoveredProviderRecord[];
  runtimes: {
    ollama?: LocalLlmRuntimeStatus;
    lmstudio?: LocalLlmRuntimeStatus;
  };
  notes: string[];
};

export async function discoverLocalProviders(params: {
  cfg: AntConfig;
  logger: Logger;
  now?: number;
}): Promise<LocalLlmDiscoveryResult> {
  const now = params.now ?? Date.now();
  const logger = params.logger.child({ component: "local-llm-manager" });
  const providers: DiscoveredProviderRecord[] = [];
  const notes: string[] = [];

  const localCfg = params.cfg.resolved.providers.local ?? {
    enabled: true,
    preferFastModels: true,
    autoDownloadModels: false,
    ollama: {
      enabled: true,
      endpoint: "http://localhost:11434",
      fastModels: ["llama3.2:1b", "qwen2.5:0.5b", "phi3:mini", "gemma2:2b"],
    },
    lmstudio: {
      enabled: true,
      endpoint: "http://localhost:1234/v1",
      fastModels: [
        "lmstudio-community/Llama-3.2-1B-Instruct-GGUF",
        "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
      ],
    },
  };

  if (!localCfg.enabled) {
    return { providers, runtimes: {}, notes };
  }

  const runtimes: LocalLlmDiscoveryResult["runtimes"] = {};

  // Ollama
  if (localCfg.ollama?.enabled) {
    const endpoint = normalizeBaseUrl(localCfg.ollama.endpoint ?? "http://localhost:11434");
    const status: LocalLlmRuntimeStatus = {
      reachable: false,
      endpoint,
      models: [],
    };
    try {
      const data = await fetchJson(`${endpoint}/api/tags`, 4000);
      const modelsRaw = isPlainObject(data) ? data.models : undefined;
      const models = Array.isArray(modelsRaw)
        ? modelsRaw
            .map((m) => (isPlainObject(m) ? (typeof m.name === "string" ? m.name : typeof m.model === "string" ? m.model : null) : null))
            .filter((v): v is string => Boolean(v && v.trim()))
        : [];
      status.models = uniqueStrings(models);
      status.reachable = true;
      status.selectedModel = pickPreferredModel({
        available: status.models,
        preferred: localCfg.ollama.fastModels ?? [],
        preferFast: localCfg.preferFastModels ?? true,
      });

      if (!status.selectedModel && (localCfg.autoDownloadModels ?? false) && (localCfg.ollama.fastModels?.length ?? 0) > 0) {
        const modelToPull = localCfg.ollama.fastModels[0]!;
        notes.push(`Ollama has no preferred fast models; attempted pull ${modelToPull}`);
        const result = await runCommand("ollama", ["pull", modelToPull], { timeoutMs: 5 * 60_000 });
        if (!result.ok) {
          logger.warn({ error: result.error, stderr: result.stderr.slice(0, 300) }, "ollama pull failed");
        } else {
          logger.info({ model: modelToPull }, "ollama pull succeeded");
        }
        // Re-check tags
        try {
          const next = await fetchJson(`${endpoint}/api/tags`, 4000);
          const nextModelsRaw = isPlainObject(next) ? next.models : undefined;
          const nextModels = Array.isArray(nextModelsRaw)
            ? nextModelsRaw
                .map((m) =>
                  isPlainObject(m) ? (typeof m.name === "string" ? m.name : typeof m.model === "string" ? m.model : null) : null
                )
                .filter((v): v is string => Boolean(v && v.trim()))
            : [];
          status.models = uniqueStrings(nextModels);
          status.selectedModel = pickPreferredModel({
            available: status.models,
            preferred: localCfg.ollama.fastModels ?? [],
            preferFast: localCfg.preferFastModels ?? true,
          });
        } catch (err) {
          logger.debug({ error: err instanceof Error ? err.message : String(err) }, "Failed re-fetching ollama tags after pull");
        }
      }
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
      status.reachable = false;
    }
    runtimes.ollama = status;

    if (status.reachable && status.selectedModel) {
      providers.push({
        id: "local:ollama",
        kind: "local",
        source: "ollama",
        discoveredAt: now,
        reliabilityScore: 0,
        consecutiveFailures: 0,
        config: {
          type: "ollama",
          baseUrl: endpoint,
          model: status.selectedModel,
        },
      });
    }
  }

  // LM Studio
  if (localCfg.lmstudio?.enabled) {
    const endpoint = normalizeBaseUrl(localCfg.lmstudio.endpoint ?? "http://localhost:1234/v1");
    const status: LocalLlmRuntimeStatus = {
      reachable: false,
      endpoint,
      models: [],
    };
    try {
      const data = await fetchJson(`${endpoint}/models`, 4000);
      const list = isPlainObject(data) ? data.data : undefined;
      const ids = Array.isArray(list)
        ? list
            .map((m) => (isPlainObject(m) && typeof m.id === "string" ? m.id : null))
            .filter((v): v is string => Boolean(v && v.trim()))
        : [];
      status.models = uniqueStrings(ids);
      status.reachable = true;
      status.selectedModel = pickPreferredModel({
        available: status.models,
        preferred: localCfg.lmstudio.fastModels ?? [],
        preferFast: localCfg.preferFastModels ?? true,
      });
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
      status.reachable = false;
    }

    if (process.platform === "darwin") {
      const installed = await hasAppInstalled(path.join("/Applications", "LM Studio.app"));
      status.installed = installed;
      if (installed && !status.reachable) {
        notes.push("LM Studio app installed but API endpoint not reachable");
      }
    }

    runtimes.lmstudio = status;

    if (status.reachable && status.selectedModel) {
      providers.push({
        id: "local:lmstudio",
        kind: "local",
        source: "lmstudio",
        discoveredAt: now,
        reliabilityScore: 0,
        consecutiveFailures: 0,
        config: {
          type: "openai",
          baseUrl: endpoint,
          model: status.selectedModel,
          apiKey: "not-needed",
        },
      });
    }
  }

  return { providers, runtimes, notes };
}

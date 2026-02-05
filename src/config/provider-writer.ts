import fs from "node:fs/promises";
import path from "node:path";

export type DiscoveredProviderKind = "local" | "remote";

export type DiscoveredProviderLastResult =
  | {
      ok: true;
      checkedAt: number;
      latencyMs?: number;
    }
  | {
      ok: false;
      checkedAt: number;
      error: string;
      latencyMs?: number;
    };

export type DiscoveredProviderRecord = {
  id: string;
  kind: DiscoveredProviderKind;
  source: string;
  discoveredAt: number;
  reliabilityScore?: number; // 0-100
  consecutiveFailures?: number;
  config: Record<string, unknown>;
  lastResult?: DiscoveredProviderLastResult;
};

export type ProvidersDiscoveredOverlay = {
  version: 1;
  generatedAt: number;
  providers: Record<string, DiscoveredProviderRecord>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isDiscoveredProviderRecord(value: unknown): value is DiscoveredProviderRecord {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || !value.id.trim()) return false;
  if (value.kind !== "local" && value.kind !== "remote") return false;
  if (typeof value.source !== "string" || !value.source.trim()) return false;
  if (typeof value.discoveredAt !== "number" || !Number.isFinite(value.discoveredAt)) return false;
  if (!isPlainObject(value.config)) return false;
  if (value.reliabilityScore !== undefined) {
    if (typeof value.reliabilityScore !== "number" || !Number.isFinite(value.reliabilityScore)) return false;
  }
  if (value.consecutiveFailures !== undefined) {
    if (typeof value.consecutiveFailures !== "number" || !Number.isFinite(value.consecutiveFailures)) return false;
  }
  if (value.lastResult !== undefined) {
    if (!isPlainObject(value.lastResult)) return false;
    if (typeof value.lastResult.ok !== "boolean") return false;
    if (typeof value.lastResult.checkedAt !== "number" || !Number.isFinite(value.lastResult.checkedAt)) return false;
    if (value.lastResult.ok === false) {
      if (typeof (value.lastResult as any).error !== "string") return false;
    }
  }
  return true;
}

export function getProvidersDiscoveredPath(stateDir: string): string {
  return path.join(stateDir, "providers.discovered.json");
}

export async function readProvidersDiscoveredOverlay(
  stateDir: string
): Promise<{ ok: true; overlay: ProvidersDiscoveredOverlay | null } | { ok: false; overlay: null; error: string }> {
  const overlayPath = getProvidersDiscoveredPath(stateDir);
  try {
    const raw = await fs.readFile(overlayPath, "utf-8").catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    });
    if (!raw) return { ok: true, overlay: null };

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) return { ok: false, overlay: null, error: "invalid_json" };
    if (parsed.version !== 1) return { ok: false, overlay: null, error: "unsupported_version" };
    if (typeof parsed.generatedAt !== "number" || !Number.isFinite(parsed.generatedAt)) {
      return { ok: false, overlay: null, error: "invalid_generated_at" };
    }
    if (!isPlainObject(parsed.providers)) return { ok: false, overlay: null, error: "invalid_providers" };

    const providers: Record<string, DiscoveredProviderRecord> = {};
    for (const [id, record] of Object.entries(parsed.providers)) {
      if (!isDiscoveredProviderRecord(record)) continue;
      providers[id] = { ...record, id };
    }

    return {
      ok: true,
      overlay: {
        version: 1,
        generatedAt: parsed.generatedAt,
        providers,
      },
    };
  } catch (err) {
    return { ok: false, overlay: null, error: err instanceof Error ? err.message : String(err) };
  }
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

function isEnvVarReference(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  if (/^\$[A-Z0-9_]+$/.test(raw)) return true;
  if (/^\$\{[A-Z0-9_]+\}$/.test(raw)) return true;
  if (/^\$\{ENV:[A-Z0-9_]+\}$/.test(raw)) return true;
  if (/^env:[A-Z0-9_]+$/i.test(raw)) return true;
  return false;
}

function sanitizeProviderConfig(record: DiscoveredProviderRecord): DiscoveredProviderRecord {
  const cfg = isPlainObject(record.config) ? { ...record.config } : {};
  if (cfg.type === "openai") {
    const baseUrl = cfg.baseUrl;
    if (!isLocalBaseUrl(baseUrl)) {
      const apiKey = cfg.apiKey;
      if (apiKey && !isEnvVarReference(apiKey)) {
        delete cfg.apiKey;
      }
      if (Array.isArray(cfg.authProfiles)) {
        cfg.authProfiles = cfg.authProfiles
          .filter((profile) => isPlainObject(profile))
          .map((profile) => {
            const next = { ...profile };
            if (next.apiKey && !isEnvVarReference(next.apiKey)) {
              delete next.apiKey;
            }
            return next;
          })
          .filter((profile) => typeof profile.apiKey === "string" && profile.apiKey.trim());
      }
    }
  }
  return { ...record, config: cfg };
}

export async function writeProvidersDiscoveredOverlay(
  stateDir: string,
  overlay: ProvidersDiscoveredOverlay,
  opts?: { backup?: boolean }
): Promise<{ ok: true; path: string; backupPath?: string } | { ok: false; error: string }> {
  const overlayPath = getProvidersDiscoveredPath(stateDir);
  const backup = opts?.backup ?? false;
  try {
    await fs.mkdir(stateDir, { recursive: true });

    let backupPath: string | undefined;
    if (backup) {
      const exists = await fs
        .stat(overlayPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupPath = path.join(stateDir, `providers.discovered.backup-${stamp}.json`);
        await fs.copyFile(overlayPath, backupPath).catch(() => undefined);
      }
    }

    const sanitized: ProvidersDiscoveredOverlay = {
      version: 1,
      generatedAt: overlay.generatedAt,
      providers: Object.fromEntries(
        Object.entries(overlay.providers).map(([id, record]) => [id, sanitizeProviderConfig({ ...record, id })])
      ),
    };

    const tmp = `${overlayPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(sanitized, null, 2) + "\n", "utf-8");
    await fs.rename(tmp, overlayPath);

    return { ok: true, path: overlayPath, ...(backupPath ? { backupPath } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

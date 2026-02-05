import fs from "node:fs/promises";
import path from "node:path";

import {
  BufferJSON,
  initAuthCreds,
  useMultiFileAuthState,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";

type PersistedAuthState = {
  creds: AuthenticationCreds;
  keys: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>>;
};

type CompactAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
};

function fixLegacyFileName(file: string): string {
  return file.replace(/\//g, "__").replace(/:/g, "-");
}

function buildLegacyKeyPath(sessionDir: string, type: string, id: string): string {
  return path.join(sessionDir, fixLegacyFileName(`${type}-${id}.json`));
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeKeys(value: unknown): Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>> {
  if (!isNonNullObject(value)) return {};
  const out: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isNonNullObject(v)) continue;
    out[k as keyof SignalDataTypeMap] = { ...v };
  }
  return out;
}

export async function useCompactAuthState(sessionDir: string): Promise<CompactAuthState> {
  await fs.mkdir(sessionDir, { recursive: true });

  const statePath = path.join(sessionDir, "auth-state.json");
  let creds: AuthenticationCreds | null = null;
  let keys: Partial<Record<keyof SignalDataTypeMap, Record<string, unknown>>> = {};
  let legacyState: Awaited<ReturnType<typeof useMultiFileAuthState>> | null = null;
  let persistTimer: NodeJS.Timeout | null = null;
  let writeChain = Promise.resolve();

  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw, BufferJSON.reviver) as PersistedAuthState;
    if (parsed && parsed.creds) {
      creds = parsed.creds;
      keys = normalizeKeys(parsed.keys);
    }
  } catch {
    // no compact state yet
  }

  const ensureLegacyState = async () => {
    if (legacyState) return legacyState;
    legacyState = await useMultiFileAuthState(sessionDir);
    return legacyState;
  };

  if (!creds) {
    try {
      const legacy = await ensureLegacyState();
      creds = legacy.state.creds;
    } catch {
      creds = initAuthCreds();
    }
  }

  const persistNow = async () => {
    const payload: PersistedAuthState = {
      creds: creds!,
      keys,
    };
    const tmpPath = `${statePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload, BufferJSON.replacer), "utf-8");
    await fs.rename(tmpPath, statePath);
  };

  const schedulePersist = (): Promise<void> =>
    new Promise((resolve) => {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = null;
        writeChain = writeChain
          .then(() => persistNow())
          .catch(() => undefined)
          .then(() => resolve());
      }, 120);
      persistTimer.unref?.();
    });

  const removeLegacyKeyFile = async (type: string, id: string): Promise<void> => {
    const legacyPath = buildLegacyKeyPath(sessionDir, type, id);
    await fs.unlink(legacyPath).catch(() => undefined);
  };

  // Ensure compact state file exists so subsequent boots never need multi-file writes.
  await persistNow().catch(() => undefined);

  return {
    state: {
      creds: creds!,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
          const out: Record<string, SignalDataTypeMap[T]> = {};
          const bucket = (keys[type] ?? {}) as Record<string, SignalDataTypeMap[T]>;
          const missing: string[] = [];

          for (const id of ids) {
            if (id in bucket && bucket[id] != null) {
              out[id] = bucket[id]!;
            } else {
              missing.push(id);
            }
          }

          if (missing.length > 0) {
            try {
              const legacy = await ensureLegacyState();
              const legacyValues = await legacy.state.keys.get(type, missing);
              let changed = false;
              for (const id of missing) {
                const value = legacyValues[id];
                if (value == null) continue;
                out[id] = value;
                const writeBucket = ((keys[type] ??= {}) as Record<string, unknown>);
                writeBucket[id] = value as unknown as SignalDataTypeMap[T];
                changed = true;
                await removeLegacyKeyFile(String(type), id);
              }
              if (changed) await schedulePersist();
            } catch {
              // Ignore legacy fallback errors; return whatever we have.
            }
          }

          return out;
        },
        set: async (data: SignalDataSet): Promise<void> => {
          for (const category of Object.keys(data) as Array<keyof SignalDataSet>) {
            const entries = data[category];
            if (!entries) continue;
            const bucket = ((keys[category as keyof SignalDataTypeMap] ??= {}) as Record<string, unknown>);
            for (const [id, value] of Object.entries(entries)) {
              if (value == null) {
                delete bucket[id];
              } else {
                bucket[id] = value as unknown;
              }
              await removeLegacyKeyFile(String(category), id);
            }
            if (Object.keys(bucket).length === 0) {
              delete keys[category as keyof SignalDataTypeMap];
            }
          }
          await schedulePersist();
        },
      },
    },
    saveCreds: async (): Promise<void> => {
      await schedulePersist();
      await fs.unlink(path.join(sessionDir, "creds.json")).catch(() => undefined);
    },
  };
}

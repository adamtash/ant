import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type EnvFileSnapshot =
  | {
      ok: true;
      path: string;
      exists: boolean;
      entries: Record<string, string>;
    }
  | { ok: false; path: string; error: string };

export type EnvFileUpdateResult =
  | { ok: true; path: string; changedKeys: string[] }
  | { ok: false; path: string; error: string };

type ParsedLine =
  | { kind: "blank" | "comment" | "raw"; raw: string }
  | { kind: "entry"; raw: string; key: string; value: string };

function resolveUserPath(value: string, baseDir?: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) return path.join(os.homedir(), trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return baseDir ? path.resolve(baseDir, trimmed) : path.resolve(trimmed);
}

function parseEnvLine(raw: string): ParsedLine {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "blank", raw };
  if (trimmed.startsWith("#")) return { kind: "comment", raw };

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length) : raw;
  const match = withoutExport.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match) return { kind: "raw", raw };

  const key = match[1] ?? "";
  const value = match[2] ?? "";
  if (!key) return { kind: "raw", raw };
  return { kind: "entry", raw, key, value };
}

function parseEnvContent(content: string): ParsedLine[] {
  return content.split(/\r?\n/).map(parseEnvLine);
}

function formatEnvValue(value: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error("Env values cannot contain newlines");
  }
  if (!value) return "";
  if (/[\s#]/.test(value)) return JSON.stringify(value);
  return value;
}

export function resolveEnvFilePath(configPath?: string): string {
  const explicit = (process.env.ANT_ENV_PATH || "").trim();
  if (explicit) return resolveUserPath(explicit);

  const cwdCandidate = path.join(process.cwd(), ".env");
  if (fsSync.existsSync(cwdCandidate) && fsSync.statSync(cwdCandidate).isFile()) {
    return cwdCandidate;
  }

  if (configPath) {
    return path.join(path.dirname(configPath), ".env");
  }

  return cwdCandidate;
}

export async function readEnvSnapshot(envPath: string): Promise<EnvFileSnapshot> {
  const resolvedPath = resolveUserPath(envPath);
  try {
    const raw = await fs.readFile(resolvedPath, "utf-8");
    const entries: Record<string, string> = {};
    for (const line of parseEnvContent(raw)) {
      if (line.kind !== "entry") continue;
      entries[line.key] = line.value;
    }
    return { ok: true, path: resolvedPath, exists: true, entries };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT") {
      return { ok: true, path: resolvedPath, exists: false, entries: {} };
    }
    return {
      ok: false,
      path: resolvedPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function applyEnvUpdates(
  envPath: string,
  updates: Record<string, string | null>,
): Promise<EnvFileUpdateResult> {
  const resolvedPath = resolveUserPath(envPath);
  const safeUpdates: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(updates)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    safeUpdates[normalizedKey] = value === null ? null : String(value);
  }

  try {
    let current = "";
    try {
      current = await fs.readFile(resolvedPath, "utf-8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code !== "ENOENT") throw err;
    }

    const parsed = parseEnvContent(current);
    const handled = new Set<string>();
    const nextLines: string[] = [];

    for (const line of parsed) {
      if (line.kind !== "entry") {
        nextLines.push(line.raw);
        continue;
      }

      if (!(line.key in safeUpdates)) {
        nextLines.push(line.raw);
        continue;
      }

      const nextValue = safeUpdates[line.key];
      handled.add(line.key);
      if (nextValue === null) {
        // Drop the line.
        continue;
      }
      nextLines.push(`${line.key}=${formatEnvValue(nextValue)}`);
    }

    const toAppend = Object.entries(safeUpdates)
      .filter(([key, value]) => !handled.has(key) && value !== null)
      .map(([key, value]) => `${key}=${formatEnvValue(value ?? "")}`);

    if (toAppend.length > 0) {
      if (nextLines.length > 0 && nextLines[nextLines.length - 1]?.trim() !== "") {
        nextLines.push("");
      }
      nextLines.push(...toAppend);
    }

    const output = `${nextLines.join("\n")}\n`;
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, output, "utf-8");

    const changedKeys = Object.keys(safeUpdates);
    return { ok: true, path: resolvedPath, changedKeys };
  } catch (err) {
    return {
      ok: false,
      path: resolvedPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

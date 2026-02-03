/**
 * Telegram Pairing Store
 *
 * Persists:
 * - allowFrom: approved Telegram user IDs / usernames
 * - requests: pending pairing requests with human-friendly codes
 *
 * Stored under `${cfg.resolved.telegramStateDir}/pairing.json`.
 */

import { randomUUID, randomInt } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../../config.js";

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_REQUEST_TTL_MS = 60 * 60 * 1000; // 1 hour
const PAIRING_MAX_PENDING = 50;

export type TelegramPairingRequest = {
  id: string;
  code: string;
  userId: string;
  chatId: string;
  username?: string;
  createdAt: number;
  lastSeenAt: number;
};

type TelegramPairingStore = {
  version: 1;
  allowFrom: string[];
  requests: TelegramPairingRequest[];
};

const DEFAULT_STORE: TelegramPairingStore = {
  version: 1,
  allowFrom: [],
  requests: [],
};

const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => (release = resolve));
  fileLocks.set(filePath, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (fileLocks.get(filePath) === next) {
      fileLocks.delete(filePath);
    }
  }
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readStoreFile(filePath: string): Promise<TelegramPairingStore> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = safeParseJson<TelegramPairingStore>(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_STORE };
    const allowFrom = Array.isArray((parsed as any).allowFrom) ? (parsed as any).allowFrom : [];
    const requests = Array.isArray((parsed as any).requests)
      ? ((parsed as any).requests as unknown[])
      : [];
    return {
      version: 1,
      allowFrom: allowFrom.map((v: unknown) => normalizeAllowEntry(String(v))).filter(Boolean),
      requests: requests
        .map((v: any): TelegramPairingRequest => ({
          id: String(v?.id ?? ""),
          code: String(v?.code ?? ""),
          userId: String(v?.userId ?? ""),
          chatId: String(v?.chatId ?? ""),
          username: typeof v?.username === "string" ? v.username : undefined,
          createdAt: typeof v?.createdAt === "number" ? v.createdAt : 0,
          lastSeenAt: typeof v?.lastSeenAt === "number" ? v.lastSeenAt : 0,
        }))
        .filter((r: TelegramPairingRequest) => Boolean(r.id && r.code && r.userId && r.chatId)),
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return { ...DEFAULT_STORE };
    return { ...DEFAULT_STORE };
  }
}

async function writeStoreFile(filePath: string, value: TelegramPairingStore): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}

export function resolveTelegramPairingStorePath(cfg: AntConfig): string {
  return path.join(cfg.resolved.telegramStateDir, "pairing.json");
}

function isExpired(req: TelegramPairingRequest, nowMs: number): boolean {
  return !req.createdAt || nowMs - req.createdAt > PAIRING_REQUEST_TTL_MS;
}

function prune(store: TelegramPairingStore, nowMs: number): TelegramPairingStore {
  const requests = store.requests.filter((r) => !isExpired(r, nowMs));
  const allowFrom = store.allowFrom.map(normalizeAllowEntry).filter(Boolean);
  return {
    version: 1,
    allowFrom: Array.from(new Set(allowFrom)).sort(),
    requests: requests
      .slice()
      .sort((a, b) => (a.lastSeenAt || a.createdAt) - (b.lastSeenAt || b.createdAt))
      .slice(-PAIRING_MAX_PENDING),
  };
}

function randomCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    const idx = randomInt(0, PAIRING_CODE_ALPHABET.length);
    out += PAIRING_CODE_ALPHABET[idx];
  }
  return out;
}

function generateUniqueCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const code = randomCode();
    if (!existing.has(code)) return code;
  }
  throw new Error("failed to generate unique pairing code");
}

export function normalizeAllowEntry(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const stripped = trimmed.replace(/^(telegram|tg):/i, "");
  if (!stripped) return "";
  if (stripped.startsWith("@")) return stripped.toLowerCase();
  if (/^\d+$/.test(stripped)) return stripped;
  // Accept username without @ (common copy/paste).
  return `@${stripped.toLowerCase()}`;
}

export async function getTelegramPairingSnapshot(cfg: AntConfig): Promise<{
  allowFrom: string[];
  requests: TelegramPairingRequest[];
}> {
  const filePath = resolveTelegramPairingStorePath(cfg);
  const store = prune(await readStoreFile(filePath), Date.now());
  return { allowFrom: store.allowFrom, requests: store.requests };
}

export async function isTelegramAllowedSender(params: {
  cfg: AntConfig;
  senderUserId: string;
  senderUsername?: string;
}): Promise<boolean> {
  const userId = String(params.senderUserId).trim();
  const username = params.senderUsername ? params.senderUsername.trim().toLowerCase() : undefined;

  const configAllow = (params.cfg.telegram?.allowFrom ?? []).map(normalizeAllowEntry).filter(Boolean);
  const storeAllow = (await getTelegramPairingSnapshot(params.cfg)).allowFrom;
  const allowed = new Set<string>([...configAllow, ...storeAllow].map((v) => v.toLowerCase()));

  if (allowed.has(userId.toLowerCase())) return true;
  if (username && allowed.has(username)) return true;
  if (username && allowed.has(`@${username}`)) return true;
  return false;
}

export async function upsertTelegramPairingRequest(params: {
  cfg: AntConfig;
  userId: string;
  chatId: string;
  username?: string;
}): Promise<{ request: TelegramPairingRequest; created: boolean }> {
  const filePath = resolveTelegramPairingStorePath(params.cfg);
  return await withFileLock(filePath, async () => {
    const now = Date.now();
    const store = prune(await readStoreFile(filePath), now);
    const userId = String(params.userId).trim();
    const chatId = String(params.chatId).trim();
    const username = params.username ? params.username.trim() : undefined;

    // If already allowed, don't create a request.
    const alreadyAllowed = await isTelegramAllowedSender({
      cfg: params.cfg,
      senderUserId: userId,
      senderUsername: username,
    });
    if (alreadyAllowed) {
      return {
        request: {
          id: "already_allowed",
          code: "ALREADY_ALLOWED",
          userId,
          chatId,
          username,
          createdAt: now,
          lastSeenAt: now,
        },
        created: false,
      };
    }

    const existing = store.requests.find((r) => r.userId === userId);
    if (existing) {
      existing.lastSeenAt = now;
      if (username && !existing.username) existing.username = username;
      await writeStoreFile(filePath, store);
      return { request: existing, created: false };
    }

    const existingCodes = new Set(store.requests.map((r) => r.code));
    const request: TelegramPairingRequest = {
      id: randomUUID(),
      code: generateUniqueCode(existingCodes),
      userId,
      chatId,
      username,
      createdAt: now,
      lastSeenAt: now,
    };
    store.requests.push(request);
    const next = prune(store, now);
    await writeStoreFile(filePath, next);
    return { request, created: true };
  });
}

export async function approveTelegramPairingCode(params: {
  cfg: AntConfig;
  code: string;
}): Promise<{ ok: boolean; request?: TelegramPairingRequest; allowFrom?: string[]; error?: string }> {
  const filePath = resolveTelegramPairingStorePath(params.cfg);
  return await withFileLock(filePath, async () => {
    const now = Date.now();
    const store = prune(await readStoreFile(filePath), now);
    const code = String(params.code).trim().toUpperCase();
    if (!code) return { ok: false, error: "code is required" };

    const idx = store.requests.findIndex((r) => r.code.toUpperCase() === code);
    if (idx === -1) return { ok: false, error: "pairing code not found (or expired)" };

    const request = store.requests[idx]!;
    store.requests.splice(idx, 1);
    const entry = normalizeAllowEntry(request.userId);
    if (entry) store.allowFrom = Array.from(new Set([...store.allowFrom, entry]));

    const next = prune(store, now);
    await writeStoreFile(filePath, next);
    return { ok: true, request, allowFrom: next.allowFrom };
  });
}

export async function denyTelegramPairingCode(params: {
  cfg: AntConfig;
  code: string;
}): Promise<{ ok: boolean; request?: TelegramPairingRequest; error?: string }> {
  const filePath = resolveTelegramPairingStorePath(params.cfg);
  return await withFileLock(filePath, async () => {
    const now = Date.now();
    const store = prune(await readStoreFile(filePath), now);
    const code = String(params.code).trim().toUpperCase();
    if (!code) return { ok: false, error: "code is required" };

    const idx = store.requests.findIndex((r) => r.code.toUpperCase() === code);
    if (idx === -1) return { ok: false, error: "pairing code not found (or expired)" };

    const request = store.requests[idx]!;
    store.requests.splice(idx, 1);
    const next = prune(store, now);
    await writeStoreFile(filePath, next);
    return { ok: true, request };
  });
}

export async function removeTelegramAllowFromEntry(params: {
  cfg: AntConfig;
  entry: string;
}): Promise<{ ok: boolean; allowFrom?: string[]; error?: string }> {
  const filePath = resolveTelegramPairingStorePath(params.cfg);
  return await withFileLock(filePath, async () => {
    const now = Date.now();
    const store = prune(await readStoreFile(filePath), now);
    const entry = normalizeAllowEntry(params.entry);
    if (!entry) return { ok: false, error: "entry is required" };

    const before = store.allowFrom.length;
    store.allowFrom = store.allowFrom.filter((e) => e.toLowerCase() !== entry.toLowerCase());
    const next = prune(store, now);
    if (next.allowFrom.length !== before) {
      await writeStoreFile(filePath, next);
    }
    return { ok: true, allowFrom: next.allowFrom };
  });
}

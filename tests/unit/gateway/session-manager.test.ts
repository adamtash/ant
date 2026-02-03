import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import { SessionManager } from "../../../src/gateway/session-manager.js";
import type { StorageBackend, StorageKey } from "../../../src/gateway/storage.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

describe("SessionManager", () => {
  let stateDir: string;

  beforeAll(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "ant-session-manager-"));
  });

  afterAll(async () => {
    try {
      await fs.rm(stateDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates, appends, reads, and clears session messages", async () => {
    const sm = new SessionManager({ stateDir, logger: mockLogger as any });
    await sm.initialize();

    const sessionKey = "cli:ask:demo";
    await sm.getOrCreate({ sessionKey, channel: "cli", chatId: "demo" });

    await sm.appendMessage(sessionKey, { role: "user", content: "hello", timestamp: Date.now() });
    await sm.appendMessage(sessionKey, { role: "assistant", content: "hi", timestamp: Date.now() });

    const messages = await sm.readMessages(sessionKey);
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages[messages.length - 2].role).toBe("user");
    expect(messages[messages.length - 1].role).toBe("assistant");

    const limited = await sm.readMessages(sessionKey, 1);
    expect(limited.length).toBe(1);
    expect(limited[0].content).toBe("hi");

    await sm.clear(sessionKey);
    const afterClear = await sm.readMessages(sessionKey);
    expect(afterClear.length).toBe(0);
  });

  it("sanitizes session keys for filenames", async () => {
    const sm = new SessionManager({ stateDir, logger: mockLogger as any });
    await sm.initialize();

    const sessionKey = "whatsapp:dm:+1 (555) 123-4567@s.whatsapp.net";
    await sm.getOrCreate({ sessionKey, channel: "whatsapp", chatId: "+15551234567@s.whatsapp.net" });
    await sm.appendMessage(sessionKey, { role: "user", content: "test", timestamp: Date.now() });

    const sessionsDir = path.join(stateDir, "sessions");
    const files = await fs.readdir(sessionsDir);
    expect(files.some((f) => f.includes("whatsapp_dm_"))).toBe(true);

    const loaded = await sm.readMessages(sessionKey);
    expect(loaded.length).toBe(1);
    expect(loaded[0].content).toBe("test");
  });

  it("serializes concurrent appends per session", async () => {
    class DelayedStorage implements StorageBackend {
      private readonly lines = new Map<string, unknown[]>();

      private keyToString(key: StorageKey): string {
        return key.join("/");
      }

      async appendJsonLine(key: StorageKey, value: unknown): Promise<void> {
        const payload = value as { content?: unknown };
        const content = typeof payload.content === "string" ? payload.content : "";
        const delayMs = content === "one" ? 30 : content === "two" ? 10 : 0;
        await new Promise((r) => setTimeout(r, delayMs));
        const k = this.keyToString(key);
        const arr = this.lines.get(k) ?? [];
        arr.push(value);
        this.lines.set(k, arr);
      }

      async readJsonLines<T>(key: StorageKey): Promise<T[]> {
        const arr = this.lines.get(this.keyToString(key)) ?? [];
        return arr as T[];
      }

      async writeJson(): Promise<void> {
        // not needed for this test
      }

      async readJson<T>(): Promise<T | undefined> {
        return undefined;
      }

      async listKeys(): Promise<StorageKey[]> {
        return [];
      }

      async remove(): Promise<void> {
        // not needed for this test
      }
    }

    const storage = new DelayedStorage();
    const sm = new SessionManager({ stateDir, logger: mockLogger as any, storage });
    await sm.initialize();

    const sessionKey = "cli:ask:concurrent";
    await sm.getOrCreate({ sessionKey, channel: "cli", chatId: "concurrent" });

    const now = Date.now();
    await Promise.all([
      sm.appendMessage(sessionKey, { role: "assistant", content: "one", timestamp: now + 1 }),
      sm.appendMessage(sessionKey, { role: "assistant", content: "two", timestamp: now + 2 }),
      sm.appendMessage(sessionKey, { role: "assistant", content: "three", timestamp: now + 3 }),
    ]);

    const messages = await sm.readMessages(sessionKey);
    const lastThree = messages.slice(-3).map((m) => m.content);
    expect(lastThree).toEqual(["one", "two", "three"]);
  });
});

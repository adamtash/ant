/**
 * Storage Backend - Abstracts persistence for gateway state
 */

import fs from "node:fs/promises";
import path from "node:path";

export type StorageKey = string[];

export interface StorageBackend {
  appendJsonLine(key: StorageKey, value: unknown): Promise<void>;
  readJsonLines<T>(key: StorageKey): Promise<T[]>;
  writeJson(key: StorageKey, value: unknown): Promise<void>;
  readJson<T>(key: StorageKey): Promise<T | undefined>;
  listKeys(prefix: StorageKey): Promise<StorageKey[]>;
  remove(key: StorageKey): Promise<void>;
}

export class FileStorageBackend implements StorageBackend {
  constructor(private readonly baseDir: string) {}

  async appendJsonLine(key: StorageKey, value: unknown): Promise<void> {
    const filePath = this.resolvePath(key, "jsonl");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const line = JSON.stringify(value) + "\n";
    await fs.appendFile(filePath, line, "utf-8");
  }

  async readJsonLines<T>(key: StorageKey): Promise<T[]> {
    const filePath = this.resolvePath(key, "jsonl");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const items: T[] = [];
      for (const line of lines) {
        try {
          items.push(JSON.parse(line) as T);
        } catch {
          // Skip invalid lines
        }
      }
      return items;
    } catch {
      return [];
    }
  }

  async writeJson(key: StorageKey, value: unknown): Promise<void> {
    const filePath = this.resolvePath(key, "json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
  }

  async readJson<T>(key: StorageKey): Promise<T | undefined> {
    const filePath = this.resolvePath(key, "json");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch {
      return undefined;
    }
  }

  async listKeys(prefix: StorageKey): Promise<StorageKey[]> {
    const dirPath = this.resolvePath(prefix);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const name = entry.name.replace(/\.(json|jsonl)$/i, "");
          return [...prefix, name];
        });
    } catch {
      return [];
    }
  }

  async remove(key: StorageKey): Promise<void> {
    const filePath = this.resolvePath(key, "json");
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore missing files
    }
  }

  private resolvePath(key: StorageKey, ext?: "json" | "jsonl"): string {
    if (key.length === 0) {
      throw new Error("Storage key cannot be empty");
    }
    const parts = [...key];
    const last = parts.pop()!;
    const fileName = ext ? `${last}.${ext}` : last;
    return path.join(this.baseDir, ...parts, fileName);
  }
}

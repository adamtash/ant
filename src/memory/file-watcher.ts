/**
 * File Watcher for Memory System
 * Phase 7: Memory System Redesign
 *
 * Monitors MEMORY.md and memory/*.md files for changes
 * and triggers re-indexing with debouncing.
 */

import fs from "node:fs";
import path from "node:path";

import type { FileWatcherEvent } from "./types.js";

/**
 * Callback type for file change events
 */
export type FileWatcherCallback = (event: FileWatcherEvent) => void;

/**
 * File watcher for memory files
 */
export class FileWatcher {
  private readonly workspaceDir: string;
  private readonly debounceMs: number;
  private readonly callback: FileWatcherCallback;

  private watchers: fs.FSWatcher[] = [];
  private pendingEvents = new Map<string, NodeJS.Timeout>();
  private isRunning = false;

  constructor(
    workspaceDir: string,
    callback: FileWatcherCallback,
    debounceMs = 1500,
  ) {
    this.workspaceDir = workspaceDir;
    this.callback = callback;
    this.debounceMs = debounceMs;
  }

  /**
   * Start watching for file changes
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Watch MEMORY.md in workspace root
    await this.watchFile(path.join(this.workspaceDir, "MEMORY.md"));
    await this.watchFile(path.join(this.workspaceDir, "memory.md"));

    // Watch memory directory
    await this.watchDirectory(path.join(this.workspaceDir, "memory"));
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    this.isRunning = false;

    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors
      }
    }
    this.watchers = [];

    // Clear pending debounce timers
    for (const timeout of this.pendingEvents.values()) {
      clearTimeout(timeout);
    }
    this.pendingEvents.clear();
  }

  /**
   * Watch a single file
   */
  private async watchFile(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath);
    } catch {
      // File doesn't exist, skip
      return;
    }

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        this.handleEvent(filePath, eventType === "rename" ? "unlink" : "change");
      });

      watcher.on("error", () => {
        // Silently handle errors (file may be deleted)
      });

      this.watchers.push(watcher);
    } catch {
      // Failed to watch, skip
    }
  }

  /**
   * Watch a directory for changes
   */
  private async watchDirectory(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch {
      // Directory doesn't exist, skip
      return;
    }

    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;

        const filePath = path.join(dirPath, filename);
        const type = eventType === "rename" ? "add" : "change";

        this.handleEvent(filePath, type);
      });

      watcher.on("error", () => {
        // Silently handle errors
      });

      this.watchers.push(watcher);
    } catch {
      // Failed to watch, skip
    }
  }

  /**
   * Handle a file event with debouncing
   */
  private handleEvent(
    filePath: string,
    type: "add" | "change" | "unlink",
  ): void {
    // Clear existing debounce timer for this file
    const existing = this.pendingEvents.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debounce timer
    const timeout = setTimeout(() => {
      this.pendingEvents.delete(filePath);
      this.emitEvent(filePath, type);
    }, this.debounceMs);

    this.pendingEvents.set(filePath, timeout);
  }

  /**
   * Emit a file event to the callback
   */
  private emitEvent(filePath: string, type: "add" | "change" | "unlink"): void {
    // Verify the final state of the file
    fs.promises
      .access(filePath)
      .then(() => {
        // File exists
        const actualType = type === "unlink" ? "change" : type;
        this.callback({
          type: actualType,
          path: filePath,
          timestamp: Date.now(),
        });
      })
      .catch(() => {
        // File doesn't exist
        this.callback({
          type: "unlink",
          path: filePath,
          timestamp: Date.now(),
        });
      });
  }
}

/**
 * List all memory files in a workspace
 */
export async function listMemoryFiles(
  workspaceDir: string,
): Promise<Array<{ path: string; relativePath: string }>> {
  const files: Array<{ path: string; relativePath: string }> = [];

  // Check root memory files
  const rootFiles = ["MEMORY.md", "memory.md"];
  for (const name of rootFiles) {
    const filePath = path.join(workspaceDir, name);
    try {
      await fs.promises.access(filePath);
      files.push({ path: filePath, relativePath: name });
    } catch {
      // File doesn't exist
    }
  }

  // Check memory directory
  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.promises.readdir(memoryDir);
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      files.push({
        path: path.join(memoryDir, name),
        relativePath: `memory/${name}`,
      });
    }
  } catch {
    // Directory doesn't exist
  }

  return files;
}

/**
 * Watch memory files with automatic re-indexing
 */
export function createMemoryFileWatcher(
  workspaceDir: string,
  onReindex: (filePath: string) => Promise<void>,
  debounceMs = 1500,
): FileWatcher {
  const watcher = new FileWatcher(
    workspaceDir,
    async (event) => {
      if (event.type === "unlink") {
        // File was deleted, could trigger cleanup
        // For now, we'll let the next full index handle it
        return;
      }

      try {
        await onReindex(event.path);
      } catch {
        // Failed to reindex, will retry on next change
      }
    },
    debounceMs,
  );

  return watcher;
}

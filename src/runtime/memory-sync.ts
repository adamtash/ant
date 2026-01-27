import fs from "node:fs";
import path from "node:path";

import type { AntConfig } from "../config.js";
import type { Logger } from "../log.js";
import type { MemoryManager } from "../memory/index.js";

export function startMemorySync(params: {
  cfg: AntConfig;
  memory: MemoryManager;
  logger: Logger;
  sessionsDir: string;
}): { stop: () => void } {
  const syncCfg = params.cfg.memory.sync;
  let timer: NodeJS.Timeout | null = null;
  let interval: NodeJS.Timeout | null = null;

  const debounce = () => {
    if (!syncCfg.watch) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void params.memory.syncIfNeeded("watch");
    }, syncCfg.watchDebounceMs);
  };

  let memoryWatcher: fs.FSWatcher | null = null;
  let sessionWatcher: fs.FSWatcher | null = null;

  if (syncCfg.watch) {
    const memoryDir = path.join(params.cfg.resolved.workspaceDir, "memory");
    try {
      memoryWatcher = fs.watch(memoryDir, { recursive: true }, debounce);
    } catch {
      // ignore
    }
    try {
      sessionWatcher = fs.watch(params.sessionsDir, { recursive: true }, debounce);
    } catch {
      // ignore
    }
  }

  if (syncCfg.intervalMinutes > 0) {
    interval = setInterval(() => {
      void params.memory.syncIfNeeded("interval");
    }, syncCfg.intervalMinutes * 60_000);
    interval.unref?.();
  }

  if (syncCfg.onSessionStart) {
    void params.memory.syncIfNeeded("startup");
  }

  return {
    stop: () => {
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
      memoryWatcher?.close();
      sessionWatcher?.close();
      params.logger.info("memory sync stopped");
    },
  };
}

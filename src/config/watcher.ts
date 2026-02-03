import fs from "node:fs";
import path from "node:path";

import type { AntConfig } from "../config.js";
import { loadConfig } from "../config.js";
import type { Logger } from "../log.js";
import { buildReloadPlanFromConfigs, type ReloadPlan } from "./reload-rules.js";

export type ConfigChangeEvent = {
  prev: AntConfig;
  next: AntConfig;
  plan: ReloadPlan;
};

export type ConfigWatcher = {
  start: () => void;
  stop: () => void;
  setCurrent: (next: AntConfig) => void;
  getCurrent: () => AntConfig;
};

export function createConfigWatcher(params: {
  initial: AntConfig;
  configPath: string;
  logger: Logger;
  debounceMs?: number;
  onChange: (event: ConfigChangeEvent) => Promise<void>;
}): ConfigWatcher {
  const logger = params.logger.child({ component: "config-watcher" });
  const configPath = path.resolve(params.configPath);
  const dir = path.dirname(configPath);
  const file = path.basename(configPath);
  const debounceMs = Math.max(50, params.debounceMs ?? 300);

  let current = params.initial;
  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let reloading = false;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void reload(), debounceMs);
    timer.unref?.();
  };

  const reload = async (): Promise<void> => {
    if (stopped) return;
    if (reloading) return;
    reloading = true;
    try {
      const next = await loadConfig(configPath);
      const plan = buildReloadPlanFromConfigs(current, next);
      if (plan.changedPaths.length === 0) return;
      await params.onChange({ prev: current, next, plan });
      current = next;
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Failed to reload config");
    } finally {
      reloading = false;
    }
  };

  const start = () => {
    if (watcher) return;
    stopped = false;
    try {
      watcher = fs.watch(dir, { persistent: true }, (eventType, filename) => {
        if (stopped) return;
        if (!filename || filename.toString() !== file) return;
        if (eventType !== "change" && eventType !== "rename") return;
        schedule();
      });
      watcher.on("error", (err) => {
        logger.warn({ error: err instanceof Error ? err.message : String(err) }, "Config watcher error");
      });
      logger.info({ configPath }, "Config watcher started");
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), configPath }, "Failed to start config watcher");
    }
  };

  const stop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    logger.info("Config watcher stopped");
  };

  return {
    start,
    stop,
    setCurrent: (next) => {
      current = next;
    },
    getCurrent: () => current,
  };
}

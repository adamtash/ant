import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";

export type RuntimePaths = {
  stateDir: string;
  sessionsDir: string;
  subagentsFile: string;
};

export async function ensureRuntimePaths(cfg: AntConfig): Promise<RuntimePaths> {
  const stateDir = cfg.resolved.stateDir;
  const sessionsDir = path.join(stateDir, "sessions");
  const subagentsFile = path.join(stateDir, "subagents.json");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.mkdir(path.dirname(cfg.resolved.memorySqlitePath), { recursive: true });
  await fs.mkdir(cfg.resolved.whatsappSessionDir, { recursive: true });
  return { stateDir, sessionsDir, subagentsFile };
}

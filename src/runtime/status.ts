import type { AntConfig } from "../config.js";
import { createLogger } from "../log.js";
import { ensureRuntimePaths } from "./paths.js";

export async function showStatus(cfg: AntConfig): Promise<void> {
  const logger = createLogger(cfg.logging.level);
  const paths = await ensureRuntimePaths(cfg);
  logger.info({
    workspaceDir: cfg.resolved.workspaceDir,
    stateDir: paths.stateDir,
    whatsappSessionDir: cfg.resolved.whatsappSessionDir,
    memoryDb: cfg.resolved.memorySqlitePath,
  }, "ant status");
  console.log("ant status:");
  console.log(`workspace: ${cfg.resolved.workspaceDir}`);
  console.log(`state: ${paths.stateDir}`);
  console.log(`whatsapp: ${cfg.resolved.whatsappSessionDir}`);
  console.log(`memory: ${cfg.resolved.memorySqlitePath}`);
}

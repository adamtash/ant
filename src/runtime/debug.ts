import type { AntConfig } from "../config.js";
import { createLogger } from "../log.js";
import { MemoryManager } from "../memory/index.js";
import { ProviderClients } from "./providers.js";
import { AgentRunner } from "./agent.js";
import { ensureRuntimePaths } from "./paths.js";
import { SessionStore } from "./session-store.js";
import { SubagentManager } from "./subagents.js";

export async function runDebugPrompt(cfg: AntConfig, prompt: string): Promise<void> {
  const logger = createLogger(cfg.logging.level, cfg.resolved.logFilePath, cfg.resolved.logFileLevel);
  const paths = await ensureRuntimePaths(cfg);
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const memory = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });
  const sessions = new SessionStore(paths.sessionsDir);
  const subagents = new SubagentManager({
    cfg,
    logger,
    filePath: paths.subagentsFile,
    sendMessage: async () => {},
    runTask: async () => "ok",
  });
  await subagents.load();

  const agent = new AgentRunner({
    cfg,
    logger,
    providers,
    memory,
    sessions,
    subagents,
    sendMessage: async () => {},
    sendMedia: async () => {},
  });

  const output = await agent.runTask({
    sessionKey: "debug:local",
    task: prompt,
    isSubagent: false,
  });

  console.log(output);
}

export async function runDebugInbound(cfg: AntConfig, text: string): Promise<void> {
  const logger = createLogger(cfg.logging.level, cfg.resolved.logFilePath, cfg.resolved.logFileLevel);
  const paths = await ensureRuntimePaths(cfg);
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const memory = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });
  const sessions = new SessionStore(paths.sessionsDir);
  const subagents = new SubagentManager({
    cfg,
    logger,
    filePath: paths.subagentsFile,
    sendMessage: async () => {},
    runTask: async () => "ok",
  });
  await subagents.load();

  const agent = new AgentRunner({
    cfg,
    logger,
    providers,
    memory,
    sessions,
    subagents,
    sendMessage: async () => {},
    sendMedia: async () => {},
  });

  const output = await agent.runInboundMessage({
    sessionKey: "debug:inbound",
    chatId: "debug:chat",
    text,
    isGroup: false,
    timestamp: Date.now(),
  });

  console.log(output);
}

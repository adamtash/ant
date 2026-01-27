import type { AntConfig } from "../config.js";
import { MemoryManager } from "../memory/index.js";
import { ProviderClients } from "./providers.js";

export async function memorySearchCommand(cfg: AntConfig, query: string): Promise<void> {
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const manager = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });
  let results = [];
  try {
    results = await manager.search(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    if (message.includes("No models loaded")) {
      console.error(
        "Hint: load an embeddings-capable model in LM Studio or set memory.enabled=false.",
      );
    }
    return;
  }
  if (results.length === 0) {
    console.log("No results.");
    return;
  }
  for (const res of results) {
    console.log(`${res.path}:${res.startLine}-${res.endLine} score=${res.score.toFixed(3)}`);
    console.log(res.snippet);
    console.log("---");
  }
}

export async function memoryIndexCommand(cfg: AntConfig): Promise<void> {
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const manager = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });
  try {
    await manager.indexAll();
    console.log("Memory index updated.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
  }
}

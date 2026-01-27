import { OpenAIClient } from "./openai.js";
import type { AntConfig } from "../config.js";

export type ProviderAction = "chat" | "tools" | "embeddings" | "summary" | "subagent";

export type ProviderItem = AntConfig["resolved"]["providers"]["items"][string];

export type ResolvedProvider = ProviderItem & {
  id: string;
  modelForAction: string;
};

export class ProviderClients {
  private readonly cfg: AntConfig;
  private readonly clients = new Map<string, OpenAIClient>();

  constructor(cfg: AntConfig) {
    this.cfg = cfg;
  }

  resolveProvider(action: ProviderAction): ResolvedProvider {
    const providers = this.cfg.resolved.providers;
    const routing = this.cfg.resolved.routing;
    const id = routing[action] ?? providers.default;
    const entry = providers.items[id] ?? providers.items[providers.default];
    if (!entry) {
      throw new Error(`missing provider for action ${action}`);
    }
    const modelForAction = entry.models?.[action] ?? entry.model;
    return { ...entry, id, modelForAction };
  }

  resolveProviderById(id: string, action: ProviderAction): ResolvedProvider {
    const providers = this.cfg.resolved.providers;
    const entry = providers.items[id] ?? providers.items[providers.default];
    if (!entry) {
      throw new Error(`unknown provider: ${id}`);
    }
    const modelForAction = entry.models?.[action] ?? entry.model;
    return { ...entry, id: entry === providers.items[id] ? id : providers.default, modelForAction };
  }

  getOpenAiClient(providerId: string): OpenAIClient {
    const cached = this.clients.get(providerId);
    if (cached) return cached;
    const provider = this.cfg.resolved.providers.items[providerId];
    if (!provider || provider.type !== "openai" || !provider.baseUrl) {
      throw new Error(`provider ${providerId} is not openai-capable`);
    }
    const client = new OpenAIClient({ baseUrl: provider.baseUrl, apiKey: provider.apiKey });
    this.clients.set(providerId, client);
    return client;
  }

  getEmbeddingProvider(): { provider: ResolvedProvider; client: OpenAIClient } {
    const provider = this.resolveProvider("embeddings");
    if (provider.type !== "openai") {
      throw new Error("embeddings provider must be openai-compatible");
    }
    const client = this.getOpenAiClient(provider.id);
    return { provider, client };
  }
}

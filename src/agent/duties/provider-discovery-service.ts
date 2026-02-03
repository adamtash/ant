import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../../config.js";
import type { Logger } from "../../log.js";
import type { AgentEngine } from "../engine.js";
import {
  readProvidersDiscoveredOverlay,
  writeProvidersDiscoveredOverlay,
  type ProvidersDiscoveredOverlay,
} from "../../config/provider-writer.js";
import { runProviderDiscovery } from "./provider-discovery.js";
import { runDiscoveredProvidersHealthCheck } from "./provider-health.js";

function isTruthyEnv(name: string): boolean {
  const value = (process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function sortDiscoveredProviderIds(overlay: ProvidersDiscoveredOverlay): string[] {
  const entries = Object.values(overlay.providers);
  const local = entries
    .filter((p) => p.kind === "local")
    .sort((a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0) || a.id.localeCompare(b.id))
    .map((p) => p.id);
  const remote = entries
    .filter((p) => p.kind === "remote")
    .sort((a, b) => (b.reliabilityScore ?? 0) - (a.reliabilityScore ?? 0) || a.id.localeCompare(b.id))
    .map((p) => p.id);
  return [...local, ...remote];
}

async function appendLine(filePath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => undefined);
  await fs.appendFile(filePath, `${line}\n`, "utf-8");
}

export class ProviderDiscoveryService {
  private cfg: AntConfig;
  private readonly agentEngine: AgentEngine;
  private readonly logger: Logger;
  private cachedOverlay: ProvidersDiscoveredOverlay | null = null;

  constructor(params: { cfg: AntConfig; agentEngine: AgentEngine; logger: Logger }) {
    this.cfg = params.cfg;
    this.agentEngine = params.agentEngine;
    this.logger = params.logger.child({ component: "provider-discovery-service" });
  }

  setConfig(cfg: AntConfig): void {
    this.cfg = cfg;
  }

  static isDisabledByEnv(): boolean {
    if ((process.env.NODE_ENV || "").trim() === "test") return true;
    return isTruthyEnv("ANT_DISABLE_PROVIDER_DISCOVERY");
  }

  async readOverlay(): Promise<ProvidersDiscoveredOverlay | null> {
    const result = await readProvidersDiscoveredOverlay(this.cfg.resolved.stateDir);
    if (!result.ok) return null;
    return result.overlay;
  }

  private async writeImportantMemoryNote(note: string): Promise<void> {
    const filePath = path.join(this.cfg.resolved.workspaceDir, "MEMORY.md");
    const date = new Date().toISOString().slice(0, 10);
    await appendLine(filePath, `- [${date}] **important**: ${note}`);
  }

  private async writeAgentLog(note: string): Promise<void> {
    const filePath = path.isAbsolute(this.cfg.mainAgent.logFile)
      ? this.cfg.mainAgent.logFile
      : path.join(this.cfg.resolved.workspaceDir, this.cfg.mainAgent.logFile);
    const date = new Date().toISOString();
    await appendLine(filePath, `- [${date}] ${note}`);
  }

  private async applyOverlay(next: ProvidersDiscoveredOverlay, prev: ProvidersDiscoveredOverlay | null): Promise<{
    registered: string[];
    unregistered: string[];
    fallbackChain: string[];
  }> {
    const prevIds = new Set(Object.keys(prev?.providers ?? {}));
    const nextIds = new Set(Object.keys(next.providers));

    const removed = Array.from(prevIds).filter((id) => !nextIds.has(id));
    const upsert = Array.from(nextIds);

    const unregistered: string[] = [];
    for (const id of removed) {
      if (this.agentEngine.unregisterProvider(id)) {
        unregistered.push(id);
      }
    }

    const registered: string[] = [];
    for (const id of upsert) {
      const record = next.providers[id];
      if (!record) continue;
      const config = record.config as any;
      const res = await this.agentEngine.registerDiscoveredProvider({ id, config, ensureFallbackChain: false });
      if (res.ok) registered.push(id);
    }

    const stripIds = new Set([...prevIds, ...nextIds]);
    const baseChain = (this.cfg.resolved.providers.fallbackChain ?? []).filter((id) => !stripIds.has(id));
    const discoveredOrder = sortDiscoveredProviderIds(next);
    const nextChain = Array.from(new Set([...baseChain, ...discoveredOrder]));
    this.agentEngine.applyProviderFallbackChainHotReload(nextChain);

    return { registered, unregistered, fallbackChain: nextChain };
  }

  async runDiscovery(params?: { mode?: "scheduled" | "emergency" }): Promise<{
    ok: boolean;
    overlay?: ProvidersDiscoveredOverlay;
    error?: string;
    summary?: { added: string[]; removed: string[]; kept: string[] };
  }> {
    if (ProviderDiscoveryService.isDisabledByEnv()) {
      return { ok: false, error: "provider_discovery_disabled" };
    }

    const previous = (await this.readOverlay()) ?? this.cachedOverlay;
    const result = await runProviderDiscovery({
      cfg: this.cfg,
      logger: this.logger,
      previous: previous ?? undefined,
      mode: params?.mode ?? "scheduled",
    });

    const nextOverlay = result.overlay;
    const wrote = await writeProvidersDiscoveredOverlay(this.cfg.resolved.stateDir, nextOverlay, { backup: true });
    if (!wrote.ok) {
      this.logger.warn({ error: wrote.error }, "Failed writing providers.discovered overlay");
    }

    const applied = await this.applyOverlay(nextOverlay, previous ?? null);
    this.cachedOverlay = nextOverlay;

    const note = `Provider discovery (${params?.mode ?? "scheduled"}): +${result.summary.added.length} -${result.summary.removed.length} (total ${Object.keys(nextOverlay.providers).length}).`;
    await this.writeAgentLog(note).catch(() => undefined);
    await this.writeImportantMemoryNote(note).catch(() => undefined);

    this.logger.info(
      {
        mode: params?.mode ?? "scheduled",
        added: result.summary.added,
        removed: result.summary.removed,
        fallbackCount: applied.fallbackChain.length,
      },
      "Provider discovery applied"
    );

    return { ok: true, overlay: nextOverlay, summary: result.summary };
  }

  async runHealthCheck(): Promise<{
    ok: boolean;
    overlay?: ProvidersDiscoveredOverlay;
    removedIds?: string[];
    error?: string;
  }> {
    if (ProviderDiscoveryService.isDisabledByEnv()) {
      return { ok: false, error: "provider_discovery_disabled" };
    }

    const previous = (await this.readOverlay()) ?? this.cachedOverlay;
    if (!previous) return { ok: true, overlay: { version: 1, generatedAt: Date.now(), providers: {} }, removedIds: [] };

    const checked = await runDiscoveredProvidersHealthCheck({
      overlay: previous,
      logger: this.logger,
      maxConsecutiveFailures: 3,
      timeoutMs: 8000,
    });

    const wrote = await writeProvidersDiscoveredOverlay(this.cfg.resolved.stateDir, checked.overlay, { backup: true });
    if (!wrote.ok) {
      this.logger.warn({ error: wrote.error }, "Failed writing providers.discovered overlay after health check");
    }

    const applied = await this.applyOverlay(checked.overlay, previous);
    this.cachedOverlay = checked.overlay;

    if (checked.removedIds.length > 0) {
      const note = `Provider health: removed failing providers: ${checked.removedIds.join(", ")}`;
      await this.writeAgentLog(note).catch(() => undefined);
      await this.writeImportantMemoryNote(note).catch(() => undefined);
    }

    this.logger.info(
      { removed: checked.removedIds, total: Object.keys(checked.overlay.providers).length, fallbackCount: applied.fallbackChain.length },
      "Provider health check applied"
    );

    return { ok: true, overlay: checked.overlay, removedIds: checked.removedIds };
  }
}

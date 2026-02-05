import fs from "node:fs/promises";
import path from "node:path";

import { resolveWorkspaceOrStatePath, type AntConfig } from "../../config.js";
import type { Logger } from "../../log.js";
import type { AgentEngine } from "../engine.js";
import {
  readProvidersDiscoveredOverlay,
  writeProvidersDiscoveredOverlay,
  type ProvidersDiscoveredOverlay,
} from "../../config/provider-writer.js";
import { runProviderDiscovery, countDiscoveryCandidates } from "./provider-discovery.js";
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

type DiscoveryRollup = {
  date: string;
  runs: number;
  added: number;
  removed: number;
  kept: number;
  errors: number;
  total: number;
};

function getRollupPath(stateDir: string): string {
  return path.join(stateDir, "provider-discovery-rollup.json");
}

export class ProviderDiscoveryService {
  private cfg: AntConfig;
  private readonly agentEngine: AgentEngine;
  private readonly logger: Logger;
  private cachedOverlay: ProvidersDiscoveredOverlay | null = null;
  private legacyBackupsPruned = false;

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

  private async readRollup(): Promise<DiscoveryRollup | null> {
    const filePath = getRollupPath(this.cfg.resolved.stateDir);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as DiscoveryRollup;
      if (!parsed || typeof parsed.date !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeRollup(rollup: DiscoveryRollup): Promise<void> {
    const filePath = getRollupPath(this.cfg.resolved.stateDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => undefined);
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(rollup, null, 2) + "\n", "utf-8");
    await fs.rename(tmp, filePath);
  }

  private async flushRollup(rollup: DiscoveryRollup): Promise<void> {
    const shouldLog = rollup.added > 0 || rollup.removed > 0 || rollup.errors > 0;
    if (!shouldLog) return;
    const note = `Provider discovery rollup ${rollup.date}: runs=${rollup.runs} +${rollup.added} -${rollup.removed} (total ${rollup.total}).`;
    await this.writeAgentLog(note).catch(() => undefined);
    await this.writeImportantMemoryNote(note).catch(() => undefined);
  }

  private async updateRollup(params: {
    date: string;
    added: number;
    removed: number;
    kept: number;
    total: number;
    error: boolean;
  }): Promise<void> {
    const existing = await this.readRollup();
    if (existing && existing.date !== params.date) {
      await this.flushRollup(existing);
    }

    const next: DiscoveryRollup = {
      date: params.date,
      runs: (existing && existing.date === params.date ? existing.runs : 0) + 1,
      added: (existing && existing.date === params.date ? existing.added : 0) + params.added,
      removed: (existing && existing.date === params.date ? existing.removed : 0) + params.removed,
      kept: (existing && existing.date === params.date ? existing.kept : 0) + params.kept,
      errors: (existing && existing.date === params.date ? existing.errors : 0) + (params.error ? 1 : 0),
      total: params.total,
    };
    await this.writeRollup(next);
  }

  private async writeImportantMemoryNote(note: string): Promise<void> {
    const filePath = path.join(this.cfg.resolved.workspaceDir, "MEMORY.md");
    const date = new Date().toISOString().slice(0, 10);
    await appendLine(filePath, `- [${date}] **important**: ${note}`);
  }

  private async writeAgentLog(note: string): Promise<void> {
    const filePath = resolveWorkspaceOrStatePath(
      this.cfg.mainAgent.logFile,
      this.cfg.resolved.workspaceDir,
      this.cfg.resolved.stateDir,
    );
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

    const settings = this.cfg.resolved.providers.discovery ?? this.cfg.providers?.discovery;
    const mode = params?.mode ?? "scheduled";

    if (mode === "scheduled") {
      const candidateCount = countDiscoveryCandidates(this.cfg);
      const minCandidates = settings?.minCandidates ?? 0;
      if (candidateCount < minCandidates) {
        this.logger.debug({ candidateCount, minCandidates }, "Provider discovery skipped (no candidates)");
        return { ok: true, overlay: this.cachedOverlay ?? (await this.readOverlay()) ?? undefined, summary: { added: [], removed: [], kept: [] } };
      }
    }

    await this.pruneLegacyBackupFiles().catch(() => undefined);

    const previous = (await this.readOverlay()) ?? this.cachedOverlay;
    const result = await runProviderDiscovery({
      cfg: this.cfg,
      logger: this.logger,
      previous: previous ?? undefined,
      mode,
    });

    const nextOverlay = result.overlay;
    const wrote = await writeProvidersDiscoveredOverlay(this.cfg.resolved.stateDir, nextOverlay, { backup: false });
    if (!wrote.ok) {
      this.logger.warn({ error: wrote.error }, "Failed writing providers.discovered overlay");
    }

    const applied = await this.applyOverlay(nextOverlay, previous ?? null);
    this.cachedOverlay = nextOverlay;

    const totalProviders = Object.keys(nextOverlay.providers).length;
    const note = `Provider discovery (${mode}): +${result.summary.added.length} -${result.summary.removed.length} (total ${totalProviders}).`;
    const hadChanges = result.summary.added.length > 0 || result.summary.removed.length > 0;
    const hadError = !wrote.ok;
    const logMode = settings?.logMode ?? "daily-rollup";

    if (mode === "emergency" || logMode === "changes-only") {
      if (hadChanges || hadError) {
        await this.writeAgentLog(note).catch(() => undefined);
        await this.writeImportantMemoryNote(note).catch(() => undefined);
      }
    } else if (logMode === "daily-rollup") {
      const date = new Date().toISOString().slice(0, 10);
      await this.updateRollup({
        date,
        added: result.summary.added.length,
        removed: result.summary.removed.length,
        kept: result.summary.kept.length,
        total: totalProviders,
        error: hadError,
      });
    }

    this.logger.info(
      {
        mode,
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

    await this.pruneLegacyBackupFiles().catch(() => undefined);

    const previous = (await this.readOverlay()) ?? this.cachedOverlay;
    if (!previous) return { ok: true, overlay: { version: 1, generatedAt: Date.now(), providers: {} }, removedIds: [] };

    const checked = await runDiscoveredProvidersHealthCheck({
      overlay: previous,
      logger: this.logger,
      maxConsecutiveFailures: 3,
      timeoutMs: 8000,
    });

    const wrote = await writeProvidersDiscoveredOverlay(this.cfg.resolved.stateDir, checked.overlay, { backup: false });
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

  private async pruneLegacyBackupFiles(): Promise<void> {
    if (this.legacyBackupsPruned) return;
    this.legacyBackupsPruned = true;

    try {
      const entries = await fs.readdir(this.cfg.resolved.stateDir);
      const backups = entries.filter((name) => name.startsWith("providers.discovered.backup-") && name.endsWith(".json"));
      await Promise.all(
        backups.map((name) => fs.unlink(path.join(this.cfg.resolved.stateDir, name)).catch(() => undefined))
      );
      if (backups.length > 0) {
        this.logger.info({ removed: backups.length }, "Removed legacy provider discovery backup files");
      }
    } catch {
      // ignore cleanup failures
    }
  }
}

/**
 * Memory Recall Command - Search memory
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError, ConfigError } from "../../error-handler.js";
import { MemoryManager } from "../../../memory/index.js";

export interface RecallOptions {
  config?: string;
  limit?: number;
  minScore?: number;
  json?: boolean;
  quiet?: boolean;
}

interface SearchResult {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

/**
 * Search memory
 */
export async function recall(cfg: AntConfig, query: string, options: RecallOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!query?.trim()) {
    throw new ValidationError("Search query is required", 'Provide a query: ant recall "what was..."');
  }

  if (!cfg.memory.enabled) {
    throw new ConfigError("Memory is not enabled", "Set memory.enabled=true in your config.");
  }

  const stopProgress = out.progress("Searching memory...");

  try {
    // Try runtime API first
    if (cfg.ui.enabled) {
      const results = await recallViaRuntime(cfg, query, options);
      stopProgress();

      if (results) {
        displayResults(out, results, options);
        return;
      }
    }

    // Direct memory access - MemoryManager creates its own embedding provider from config
    const manager = new MemoryManager(cfg);

    const results = await manager.search(query.trim(), {
      maxResults: options.limit,
      minScore: options.minScore,
    });

    stopProgress();
    displayResults(out, results, options);
  } catch (err) {
    stopProgress();

    if (err instanceof RuntimeError || err instanceof ValidationError || err instanceof ConfigError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No models loaded")) {
      throw new RuntimeError(
        "No embedding model loaded",
        "Load an embeddings-capable model in LM Studio or configure a different provider."
      );
    }

    throw err;
  }
}

/**
 * Try to search via runtime API
 */
async function recallViaRuntime(
  cfg: AntConfig,
  query: string,
  options: RecallOptions
): Promise<SearchResult[] | null> {
  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 10000);

    const params = new URLSearchParams({ q: query.trim() });
    if (options.limit) params.set("limit", String(options.limit));
    if (options.minScore) params.set("minScore", String(options.minScore));

    const res = await fetch(`${base}/api/memory/search?${params}`, {
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    return (await res.json()) as SearchResult[];
  } catch {
    return null;
  }
}

/**
 * Display search results
 */
function displayResults(out: OutputFormatter, results: SearchResult[], options: RecallOptions): void {
  if (options.json) {
    out.json(results);
    return;
  }

  if (results.length === 0) {
    out.info("No results found.");
    out.info("Try a different query or add more information with 'ant remember'.");
    return;
  }

  out.header("Memory Search Results");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const location = `${result.path}:${result.startLine}-${result.endLine}`;
    const score = (result.score * 100).toFixed(1);

    out.section(`Result ${i + 1} (${score}% match)`);
    out.keyValue("Location", location);
    out.newline();

    // Display snippet in a box
    out.box(result.snippet.trim());
    out.newline();
  }

  out.info(`Found ${results.length} result(s)`);
}

export default recall;

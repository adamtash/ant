/**
 * Memory Remember Command - Add a note to memory
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError, ConfigError } from "../../error-handler.js";
import { MemoryManager } from "../../../memory/index.js";

export interface RememberOptions {
  config?: string;
  category?: string;
  tags?: string;
  json?: boolean;
  quiet?: boolean;
}

interface RememberResult {
  id: string;
  content: string;
  category?: string;
  tags?: string[];
  createdAt: number;
}

/**
 * Add a note to memory
 */
export async function remember(cfg: AntConfig, note: string, options: RememberOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!note?.trim()) {
    throw new ValidationError("Note content is required", 'Provide a note: ant remember "your note"');
  }

  if (!cfg.memory.enabled) {
    throw new ConfigError("Memory is not enabled", "Set memory.enabled=true in your config.");
  }

  const stopProgress = out.progress("Saving to memory...");

  try {
    // Try runtime API first
    if (cfg.ui.enabled) {
      const result = await rememberViaRuntime(cfg, note, options);
      stopProgress();

      if (result) {
        if (options.json) {
          out.json(result);
          return;
        }

        out.success("Note saved to memory");
        out.keyValue("ID", result.id);
        if (result.category) out.keyValue("Category", result.category);
        if (result.tags?.length) out.keyValue("Tags", result.tags.join(", "));
        return;
      }
    }

    // Direct memory access - MemoryManager creates its own embedding provider from config
    const manager = new MemoryManager({ cfg });

    // Format the note content and use the update method
    const content = formatNoteContent(note.trim(), options);
    await manager.update(content, options.category || "user-note");

    stopProgress();

    if (options.json) {
      out.json({
        success: true,
        content: note.trim(),
        category: options.category,
        tags: options.tags?.split(",").map((t) => t.trim()),
      });
      return;
    }

    out.success("Note saved to memory");
    if (options.category) out.keyValue("Category", options.category);
    if (options.tags) out.keyValue("Tags", options.tags);
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
 * Try to save via runtime API
 */
async function rememberViaRuntime(
  cfg: AntConfig,
  note: string,
  options: RememberOptions
): Promise<RememberResult | null> {
  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);

    const res = await fetch(`${base}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: note.trim(),
        category: options.category,
        tags: options.tags?.split(",").map((t) => t.trim()),
      }),
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    return (await res.json()) as RememberResult;
  } catch {
    return null;
  }
}

/**
 * Format note content with metadata
 */
function formatNoteContent(note: string, options: RememberOptions): string {
  const lines: string[] = [];

  if (options.category) {
    lines.push(`[${options.category}]`);
  }

  lines.push(note);

  if (options.tags) {
    lines.push(`Tags: ${options.tags}`);
  }

  return lines.join("\n");
}

export default remember;

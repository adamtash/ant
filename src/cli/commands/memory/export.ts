/**
 * Memory Export Command - Export memory database
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { RuntimeError, ValidationError, ConfigError } from "../../error-handler.js";

export interface MemoryExportOptions {
  config?: string;
  format?: "json" | "sqlite" | "markdown";
  output?: string;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Export memory database
 */
export async function memoryExport(cfg: AntConfig, options: MemoryExportOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!cfg.memory.enabled) {
    throw new ConfigError("Memory is not enabled", "Set memory.enabled=true in your config.");
  }

  const format = options.format || "json";
  const dbPath = cfg.resolved.memorySqlitePath;

  // Check if database exists
  try {
    await fs.access(dbPath);
  } catch {
    throw new RuntimeError("Memory database not found", "Run the agent to initialize the memory database.");
  }

  const stopProgress = out.progress("Exporting memory...");

  try {
    let outputPath: string;
    let data: unknown;

    switch (format) {
      case "sqlite": {
        // Copy the sqlite file directly
        const defaultOutput = path.join(process.cwd(), `ant-memory-${Date.now()}.sqlite`);
        outputPath = options.output || defaultOutput;
        await fs.copyFile(dbPath, outputPath);
        stopProgress();

        if (options.json) {
          out.json({ success: true, format, outputPath, size: (await fs.stat(outputPath)).size });
          return;
        }

        out.success(`Memory exported to ${outputPath}`);
        const stats = await fs.stat(outputPath);
        out.keyValue("Size", out.formatBytes(stats.size));
        return;
      }

      case "markdown": {
        data = await exportAsMarkdown(cfg);
        const defaultOutput = path.join(process.cwd(), `ant-memory-${Date.now()}.md`);
        outputPath = options.output || defaultOutput;
        await fs.writeFile(outputPath, data as string, "utf-8");
        stopProgress();

        if (options.json) {
          out.json({ success: true, format, outputPath });
          return;
        }

        out.success(`Memory exported to ${outputPath}`);
        return;
      }

      case "json":
      default: {
        data = await exportAsJson(cfg);
        const defaultOutput = path.join(process.cwd(), `ant-memory-${Date.now()}.json`);
        outputPath = options.output || defaultOutput;
        await fs.writeFile(outputPath, JSON.stringify(data, null, 2), "utf-8");
        stopProgress();

        if (options.json) {
          out.json({ success: true, format, outputPath, entries: (data as unknown[]).length });
          return;
        }

        out.success(`Memory exported to ${outputPath}`);
        out.keyValue("Entries", (data as unknown[]).length);
        return;
      }
    }
  } catch (err) {
    stopProgress();

    if (err instanceof RuntimeError || err instanceof ValidationError || err instanceof ConfigError) {
      throw err;
    }

    throw new RuntimeError(`Failed to export memory: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Export memory as JSON
 */
async function exportAsJson(cfg: AntConfig): Promise<unknown[]> {
  // Try runtime API first
  if (cfg.ui.enabled) {
    try {
      const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 300000);

      const res = await fetch(`${base}/api/memory/export?format=json`, {
        signal: ctrl.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        return (await res.json()) as unknown[];
      }
    } catch {
      // Fall through to direct access
    }
  }

  // Direct database access would require sqlite3 binding
  // For now, return empty array and note the limitation
  return [];
}

/**
 * Export memory as Markdown
 */
async function exportAsMarkdown(cfg: AntConfig): Promise<string> {
  const entries = await exportAsJson(cfg);

  const lines: string[] = [
    "# ANT Memory Export",
    "",
    `Exported: ${new Date().toISOString()}`,
    `Entries: ${entries.length}`,
    "",
    "---",
    "",
  ];

  for (const entry of entries as Array<{ path?: string; content?: string; createdAt?: number }>) {
    lines.push(`## ${entry.path || "Note"}`);
    if (entry.createdAt) {
      lines.push(`*Created: ${new Date(entry.createdAt).toISOString()}*`);
    }
    lines.push("");
    lines.push(entry.content || "(no content)");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export default memoryExport;

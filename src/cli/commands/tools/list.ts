/**
 * Tools List Command - Show all available tools
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";

export interface ListToolsOptions {
  config?: string;
  category?: string;
  json?: boolean;
  quiet?: boolean;
}

interface ToolInfo {
  name: string;
  description: string;
  category: string;
  version: string;
  source: "built-in" | "dynamic";
}

/**
 * Show all available tools
 */
export async function listTools(cfg: AntConfig, options: ListToolsOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  const tools = await discoverTools(cfg);

  // Filter by category if specified
  const filtered = options.category
    ? tools.filter((t) => t.category.toLowerCase() === options.category!.toLowerCase())
    : tools;

  if (options.json) {
    out.json(filtered);
    return;
  }

  if (filtered.length === 0) {
    if (options.category) {
      out.info(`No tools found in category "${options.category}".`);
    } else {
      out.info("No tools found.");
    }
    return;
  }

  out.header("Available Tools");

  // Group by category
  const byCategory = new Map<string, ToolInfo[]>();
  for (const tool of filtered) {
    const cat = tool.category || "uncategorized";
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(tool);
  }

  for (const [category, categoryTools] of byCategory) {
    out.section(category);
    for (const tool of categoryTools) {
      const badge = tool.source === "dynamic" ? " [custom]" : "";
      out.listItem(`${tool.name}${badge} - ${tool.description}`);
    }
  }

  out.newline();
  out.info(`Total: ${filtered.length} tools. Use 'ant tool <name>' for details.`);
}

/**
 * Discover tools from the filesystem
 */
async function discoverTools(cfg: AntConfig): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = [];

  // Built-in tools directory
  const builtInDir = path.join(cfg.resolved.workspaceDir, "src", "agent", "tools");

  // Dynamic tools directory
  const dynamicDir = path.join(cfg.resolved.stateDir, "tools");

  // Scan built-in tools
  try {
    const builtInTools = await scanToolDirectory(builtInDir, "built-in");
    tools.push(...builtInTools);
  } catch {
    // No built-in tools directory
  }

  // Scan dynamic tools
  try {
    const dynamicTools = await scanToolDirectory(dynamicDir, "dynamic");
    tools.push(...dynamicTools);
  } catch {
    // No dynamic tools directory
  }

  // Also check for tools registered via runtime API
  try {
    const runtimeTools = await fetchRuntimeTools(cfg);
    for (const rt of runtimeTools) {
      if (!tools.some((t) => t.name === rt.name)) {
        tools.push(rt);
      }
    }
  } catch {
    // Runtime not available
  }

  return tools.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scan a directory for tool files
 */
async function scanToolDirectory(dir: string, source: "built-in" | "dynamic"): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        const name = path.basename(entry.name, path.extname(entry.name));
        // Try to read tool metadata from file
        try {
          const content = await fs.readFile(path.join(dir, entry.name), "utf-8");
          const meta = extractToolMeta(content);
          tools.push({
            name: meta.name || name,
            description: meta.description || "No description",
            category: meta.category || "general",
            version: meta.version || "1.0.0",
            source,
          });
        } catch {
          tools.push({
            name,
            description: "No description",
            category: "general",
            version: "1.0.0",
            source,
          });
        }
      } else if (entry.isDirectory()) {
        const subTools = await scanToolDirectory(path.join(dir, entry.name), source);
        tools.push(...subTools);
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return tools;
}

/**
 * Extract tool metadata from file content
 */
function extractToolMeta(content: string): Partial<ToolInfo> {
  const meta: Partial<ToolInfo> = {};

  // Look for meta object in code
  const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
  if (nameMatch) meta.name = nameMatch[1];

  const descMatch = content.match(/description:\s*["']([^"']+)["']/);
  if (descMatch) meta.description = descMatch[1];

  const catMatch = content.match(/category:\s*["']([^"']+)["']/);
  if (catMatch) meta.category = catMatch[1];

  const verMatch = content.match(/version:\s*["']([^"']+)["']/);
  if (verMatch) meta.version = verMatch[1];

  return meta;
}

/**
 * Fetch tools from running runtime
 */
async function fetchRuntimeTools(cfg: AntConfig): Promise<ToolInfo[]> {
  if (!cfg.ui.enabled) return [];

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 2000);

  try {
    const res = await fetch(`${base}/api/tools`, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = (await res.json()) as ToolInfo[];
    return data;
  } catch {
    return [];
  }
}

export default listTools;

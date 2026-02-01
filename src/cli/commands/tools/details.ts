/**
 * Tools Details Command - Get details about a specific tool
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { ValidationError } from "../../error-handler.js";

export interface ToolDetailsOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
}

interface ToolDetails {
  name: string;
  description: string;
  category: string;
  version: string;
  author?: string;
  source: "built-in" | "dynamic" | "runtime";
  parameters: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
  };
  examples?: string[];
  filePath?: string;
}

/**
 * Get details about a specific tool
 */
export async function toolDetails(cfg: AntConfig, name: string, options: ToolDetailsOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!name?.trim()) {
    throw new ValidationError("Tool name is required", 'Provide a tool name: ant tool <name>');
  }

  const tool = await findTool(cfg, name.trim());

  if (!tool) {
    throw new ValidationError(`Tool "${name}" not found`, "Use 'ant list-tools' to see available tools.");
  }

  if (options.json) {
    out.json(tool);
    return;
  }

  out.header(tool.name);

  out.keyValue("Description", tool.description);
  out.keyValue("Category", tool.category);
  out.keyValue("Version", tool.version);
  out.keyValue("Source", tool.source);
  if (tool.author) {
    out.keyValue("Author", tool.author);
  }

  if (tool.parameters?.properties) {
    out.section("Parameters");
    for (const [paramName, param] of Object.entries(tool.parameters.properties)) {
      const required = tool.parameters.required?.includes(paramName) ? " (required)" : "";
      const desc = param.description || "No description";
      out.listItem(`${paramName}: ${param.type}${required} - ${desc}`);
    }
  }

  if (tool.examples && tool.examples.length > 0) {
    out.section("Examples");
    for (const example of tool.examples) {
      out.listItem(example);
    }
  }

  if (tool.filePath) {
    out.newline();
    out.keyValue("File", tool.filePath);
  }

  out.newline();
}

/**
 * Find a tool by name
 */
async function findTool(cfg: AntConfig, name: string): Promise<ToolDetails | null> {
  // Try runtime first
  const runtimeTool = await findRuntimeTool(cfg, name);
  if (runtimeTool) return runtimeTool;

  // Check built-in tools
  const builtInDir = path.join(cfg.resolved.workspaceDir, "src", "agent", "tools");
  const builtInTool = await findToolInDirectory(builtInDir, name, "built-in");
  if (builtInTool) return builtInTool;

  // Check dynamic tools
  const dynamicDir = path.join(cfg.resolved.stateDir, "tools");
  const dynamicTool = await findToolInDirectory(dynamicDir, name, "dynamic");
  if (dynamicTool) return dynamicTool;

  return null;
}

/**
 * Find a tool in a directory
 */
async function findToolInDirectory(
  dir: string,
  name: string,
  source: "built-in" | "dynamic"
): Promise<ToolDetails | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        const toolName = path.basename(entry.name, path.extname(entry.name));
        if (toolName === name || entry.name === name) {
          const filePath = path.join(dir, entry.name);
          const content = await fs.readFile(filePath, "utf-8");
          return parseToolFile(content, filePath, source);
        }
      } else if (entry.isDirectory()) {
        const found = await findToolInDirectory(path.join(dir, entry.name), name, source);
        if (found) return found;
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return null;
}

/**
 * Parse tool metadata from file content
 */
function parseToolFile(content: string, filePath: string, source: "built-in" | "dynamic"): ToolDetails {
  const meta: ToolDetails = {
    name: path.basename(filePath, path.extname(filePath)),
    description: "No description",
    category: "general",
    version: "1.0.0",
    source,
    parameters: { type: "object" },
    filePath,
  };

  // Extract metadata from code
  const nameMatch = content.match(/name:\s*["']([^"']+)["']/);
  if (nameMatch) meta.name = nameMatch[1];

  const descMatch = content.match(/description:\s*["']([^"']+)["']/);
  if (descMatch) meta.description = descMatch[1];

  const catMatch = content.match(/category:\s*["']([^"']+)["']/);
  if (catMatch) meta.category = catMatch[1];

  const verMatch = content.match(/version:\s*["']([^"']+)["']/);
  if (verMatch) meta.version = verMatch[1];

  const authorMatch = content.match(/author:\s*["']([^"']+)["']/);
  if (authorMatch) meta.author = authorMatch[1];

  // Try to extract parameter definitions
  const paramsMatch = content.match(/parameters:\s*\{[\s\S]*?(?=\}[\s,])/);
  if (paramsMatch) {
    // This is a simplified extraction - in practice you'd want more robust parsing
    const propsMatch = paramsMatch[0].match(/properties:\s*\{([\s\S]*?)\}/);
    if (propsMatch) {
      const properties: Record<string, { type: string; description?: string }> = {};
      const propMatches = propsMatch[1].matchAll(/(\w+):\s*\{\s*type:\s*["'](\w+)["'](?:,\s*description:\s*["']([^"']+)["'])?\s*\}/g);
      for (const match of propMatches) {
        properties[match[1]] = {
          type: match[2],
          description: match[3],
        };
      }
      if (Object.keys(properties).length > 0) {
        meta.parameters.properties = properties;
      }
    }

    const reqMatch = paramsMatch[0].match(/required:\s*\[([\s\S]*?)\]/);
    if (reqMatch) {
      const required = reqMatch[1].match(/["'](\w+)["']/g)?.map((s) => s.replace(/["']/g, ""));
      if (required) {
        meta.parameters.required = required;
      }
    }
  }

  return meta;
}

/**
 * Find a tool from the running runtime
 */
async function findRuntimeTool(cfg: AntConfig, name: string): Promise<ToolDetails | null> {
  if (!cfg.ui.enabled) return null;

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 2000);

  try {
    const res = await fetch(`${base}/api/tools/${encodeURIComponent(name)}`, {
      signal: ctrl.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const data = (await res.json()) as ToolDetails;
    return { ...data, source: "runtime" };
  } catch {
    return null;
  }
}

export default toolDetails;

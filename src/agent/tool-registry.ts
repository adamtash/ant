/**
 * Tool Registry - Manages tool registration, discovery, and execution
 *
 * Features:
 * - Auto-discovery of built-in tools
 * - Dynamic loading of user-created tools
 * - Consistent error handling
 * - Tool metadata and documentation
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolMeta, ToolResult, ToolContext, ToolDefinition, JSONSchema } from "./types.js";
import type { Logger } from "../log.js";

/**
 * Tool Registry manages all available tools
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private readonly logger: Logger;
  private readonly builtInDir: string;
  private readonly dynamicDir: string;

  constructor(params: {
    logger: Logger;
    builtInDir: string;
    dynamicDir: string;
  }) {
    this.logger = params.logger;
    this.builtInDir = params.builtInDir;
    this.dynamicDir = params.dynamicDir;
  }

  /**
   * Initialize the registry by loading all tools
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing tool registry...");

    // Load built-in tools
    await this.loadToolsFromDirectory(this.builtInDir, "built-in");

    // Load dynamic (user-created) tools
    await this.loadToolsFromDirectory(this.dynamicDir, "dynamic");

    this.logger.info({ count: this.tools.size }, "Tool registry initialized");
  }

  /**
   * Load tools from a directory
   */
  private async loadToolsFromDirectory(dir: string, source: string): Promise<void> {
    try {
      const exists = await fs.access(dir).then(() => true).catch(() => false);
      if (!exists) {
        this.logger.debug({ dir }, `Tool directory does not exist, skipping`);
        return;
      }

      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Subdirectory with tools
          await this.loadToolsFromDirectory(path.join(dir, entry.name), source);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
          // Direct tool file
          await this.loadToolFile(path.join(dir, entry.name), source);
        }
      }
    } catch (err) {
      this.logger.warn({ dir, error: err instanceof Error ? err.message : String(err) }, "Failed to load tools from directory");
    }
  }

  /**
   * Load a single tool file
   */
  private async loadToolFile(filePath: string, source: string): Promise<void> {
    try {
      // Dynamic import
      const module = await import(filePath);

      // Support both default export and named exports
      const tools: Tool[] = [];

      if (module.default && this.isValidTool(module.default)) {
        tools.push(module.default);
      }

      // Check for named exports
      for (const [key, value] of Object.entries(module)) {
        if (key !== "default" && this.isValidTool(value)) {
          tools.push(value as Tool);
        }
      }

      for (const tool of tools) {
        this.register(tool);
        this.logger.debug({ tool: tool.meta.name, source }, "Loaded tool");
      }
    } catch (err) {
      this.logger.warn({ filePath, error: err instanceof Error ? err.message : String(err) }, "Failed to load tool file");
    }
  }

  /**
   * Check if an object is a valid Tool
   */
  private isValidTool(obj: unknown): obj is Tool {
    if (!obj || typeof obj !== "object") return false;
    const tool = obj as Partial<Tool>;
    return (
      typeof tool.meta === "object" &&
      typeof tool.meta?.name === "string" &&
      typeof tool.meta?.description === "string" &&
      typeof tool.parameters === "object" &&
      typeof tool.execute === "function"
    );
  }

  /**
   * Register a tool
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.meta.name)) {
      this.logger.warn({ tool: tool.meta.name }, "Tool already registered, replacing");
    }
    this.tools.set(tool.meta.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getByCategory(category: string): Tool[] {
    return this.getAll().filter(tool => tool.meta.category === category);
  }

  /**
   * Get tool definitions for LLM
   */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(tool => ({
      type: "function" as const,
      function: {
        name: tool.meta.name,
        description: tool.meta.description,
        parameters: tool.parameters,
      },
    }));
  }

  /**
   * Execute a tool with proper error handling
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool: ${name}`,
      };
    }

    try {
      ctx.logger.debug({ tool: name, args }, "Executing tool");
      const result = await tool.execute(args, ctx);

      // Ensure result conforms to ToolResult format
      const normalizedResult: ToolResult = {
        ok: result.ok,
        data: result.data,
        error: result.error,
        metadata: {
          ...result.metadata,
          duration: Date.now() - startTime,
        },
      };

      ctx.logger.debug({ tool: name, duration: normalizedResult.metadata?.duration }, "Tool execution complete");
      return normalizedResult;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ctx.logger.warn({ tool: name, error }, "Tool execution failed");

      return {
        ok: false,
        error,
        metadata: {
          duration: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Get tool metadata for documentation
   */
  getMetadata(): ToolMeta[] {
    return this.getAll().map(tool => tool.meta);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tool count
   */
  get count(): number {
    return this.tools.size;
  }
}

/**
 * Helper to create a tool with proper typing
 */
export function defineTool(tool: Tool): Tool {
  return tool;
}

/**
 * Helper to create tool parameters schema
 */
export function defineParams(
  properties: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }>,
  required: string[] = []
): JSONSchema {
  return {
    type: "object",
    properties,
    required,
  };
}

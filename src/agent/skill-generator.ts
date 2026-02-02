/**
 * Skill Generator - Allows agents to create new tools dynamically
 *
 * Features:
 * - Generates TypeScript tool files in src/tools/dynamic/
 * - Validates generated tool code
 * - Auto-registers new tools in the registry
 * - Tracks generated skills in SKILL_REGISTRY.md
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "../log.js";
import type { ToolRegistry } from "./tool-registry.js";
import { SkillRegistryManager } from "./skill-registry.js";

const execAsync = promisify(exec);

/**
 * Parameter definition for generated skills
 */
export interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

/**
 * Skill definition for generation
 */
export interface SkillDefinition {
  name: string;
  description: string;
  category?: string;
  version?: string;
  author?: string;
  parameters: SkillParameter[];
  implementation: string;
  dependencies?: string[];
}

/**
 * Result of skill generation
 */
export interface SkillGenerationResult {
  success: boolean;
  skillName: string;
  filePath?: string;
  error?: string;
  validationErrors?: string[];
}

/**
 * Skill Generator class
 */
export class SkillGenerator {
  private readonly logger: Logger;
  private readonly dynamicDir: string;
  private readonly workspaceDir: string;
  private readonly toolRegistry?: ToolRegistry;
  private readonly skillRegistryManager: SkillRegistryManager;

  constructor(params: {
    logger: Logger;
    dynamicDir: string;
    workspaceDir: string;
    toolRegistry?: ToolRegistry;
  }) {
    this.logger = params.logger;
    this.dynamicDir = params.dynamicDir;
    this.workspaceDir = params.workspaceDir;
    this.toolRegistry = params.toolRegistry;
    this.skillRegistryManager = new SkillRegistryManager({
      logger: params.logger,
      workspaceDir: params.workspaceDir,
    });
  }

  /**
   * Generate a new skill from a definition
   */
  async generateSkill(definition: SkillDefinition): Promise<SkillGenerationResult> {
    const startTime = Date.now();

    try {
      this.logger.info({ skillName: definition.name }, "Generating new skill");

      // 1. Validate the skill definition
      const validationErrors = this.validateDefinition(definition);
      if (validationErrors.length > 0) {
        return {
          success: false,
          skillName: definition.name,
          validationErrors,
          error: `Validation failed: ${validationErrors.join(", ")}`,
        };
      }

      // 2. Generate the TypeScript code
      const code = this.generateCode(definition);

      // 3. Ensure dynamic directory exists
      await fs.mkdir(this.dynamicDir, { recursive: true });

      // 4. Write the file
      const fileName = `${this.sanitizeName(definition.name)}.ts`;
      const filePath = path.join(this.dynamicDir, fileName);

      await fs.writeFile(filePath, code, "utf-8");
      this.logger.debug({ filePath }, "Skill file written");

      // 5. Validate TypeScript syntax
      const syntaxValid = await this.validateSyntax(filePath);
      if (!syntaxValid.valid) {
        // Remove invalid file
        await fs.unlink(filePath).catch(() => {});
        return {
          success: false,
          skillName: definition.name,
          error: `TypeScript syntax error: ${syntaxValid.error}`,
        };
      }

      // 6. Register in SKILL_REGISTRY.md
      await this.skillRegistryManager.addSkill({
        name: definition.name,
        createdAt: new Date().toISOString(),
        author: definition.author || "agent (auto)",
        purpose: definition.description,
        usage: this.generateUsageString(definition),
        parameters: this.generateParameterDocs(definition.parameters),
        status: "active",
      });

      // 7. Hot-reload into the tool registry if available
      if (this.toolRegistry) {
        try {
          // Dynamic import of the new tool
          const module = await import(filePath);
          if (module.default) {
            this.toolRegistry.register(module.default);
            this.logger.info({ skillName: definition.name }, "Skill hot-loaded into registry");
          }
        } catch (err) {
          this.logger.warn(
            { skillName: definition.name, error: err instanceof Error ? err.message : String(err) },
            "Failed to hot-load skill, will be available on restart"
          );
        }
      }

      this.logger.info(
        { skillName: definition.name, duration: Date.now() - startTime },
        "Skill generation complete"
      );

      return {
        success: true,
        skillName: definition.name,
        filePath,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ skillName: definition.name, error }, "Skill generation failed");

      return {
        success: false,
        skillName: definition.name,
        error,
      };
    }
  }

  /**
   * Validate a skill definition
   */
  private validateDefinition(definition: SkillDefinition): string[] {
    const errors: string[] = [];

    // Name validation
    if (!definition.name) {
      errors.push("Skill name is required");
    } else if (!/^[a-z][a-z0-9_]*$/.test(definition.name)) {
      errors.push("Skill name must start with a letter and contain only lowercase letters, numbers, and underscores");
    }

    // Description validation
    if (!definition.description || definition.description.length < 10) {
      errors.push("Skill description must be at least 10 characters");
    }

    // Implementation validation
    if (!definition.implementation) {
      errors.push("Skill implementation is required");
    } else {
      // Check for dangerous patterns
      const dangerousPatterns = [
        /process\.exit/,
        /require\s*\(\s*['"]child_process['"]\s*\)/,
        /eval\s*\(/,
        /Function\s*\(/,
        /rm\s+-rf/,
        /\bexec\b.*\bsh\b/,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(definition.implementation)) {
          errors.push(`Implementation contains potentially dangerous pattern: ${pattern.source}`);
        }
      }
    }

    // Parameters validation
    for (const param of definition.parameters) {
      if (!param.name) {
        errors.push("Parameter name is required");
      }
      if (!param.type) {
        errors.push(`Parameter ${param.name} must have a type`);
      }
      if (!param.description) {
        errors.push(`Parameter ${param.name} must have a description`);
      }
    }

    return errors;
  }

  /**
   * Generate TypeScript code for the skill
   */
  private generateCode(definition: SkillDefinition): string {
    const imports = definition.dependencies?.length
      ? definition.dependencies.map(dep => `import ${dep};`).join("\n")
      : "";

    const properties = definition.parameters
      .map(p => {
        const enumStr = p.enum ? `, enum: ${JSON.stringify(p.enum)}` : "";
        const defaultStr = p.default !== undefined ? `, default: ${JSON.stringify(p.default)}` : "";
        return `    ${p.name}: { type: "${p.type}", description: "${this.escapeString(p.description)}"${enumStr}${defaultStr} }`;
      })
      .join(",\n");

    const required = definition.parameters
      .filter(p => p.required !== false)
      .map(p => `"${p.name}"`)
      .join(", ");

    return `/**
 * Auto-generated skill: ${definition.name}
 * Generated at: ${new Date().toISOString()}
 * Author: ${definition.author || "agent (auto)"}
 *
 * ${definition.description}
 */

import { defineTool, defineParams } from "../../agent/tool-registry.js";
import type { ToolResult, ToolContext } from "../../agent/types.js";
${imports}

export default defineTool({
  meta: {
    name: "${this.sanitizeName(definition.name)}",
    description: "${this.escapeString(definition.description)}",
    category: "${definition.category || "dynamic"}",
    version: "${definition.version || "1.0.0"}",
    author: "${definition.author || "agent (auto)"}",
  },
  parameters: defineParams({
${properties}
  }, [${required}]),
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
${this.indentCode(definition.implementation, 6)}
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ctx.logger.error({ tool: "${definition.name}", error }, "Skill execution failed");
      return { ok: false, error };
    }
  },
});
`;
  }

  /**
   * Validate TypeScript syntax
   */
  private async validateSyntax(filePath: string): Promise<{ valid: boolean; error?: string }> {
    try {
      // Try to compile with tsc --noEmit
      const tsconfigPath = path.join(this.workspaceDir, "tsconfig.json");
      const cmd = `npx tsc --noEmit --skipLibCheck "${filePath}" --project "${tsconfigPath}" 2>&1 || true`;

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.workspaceDir,
        timeout: 300000,
      });

      const output = stdout + stderr;

      // Check for errors
      if (output.includes("error TS")) {
        const errorLines = output.split("\n").filter(line => line.includes("error TS"));
        return {
          valid: false,
          error: errorLines.slice(0, 3).join("; "),
        };
      }

      return { valid: true };
    } catch (err) {
      // If tsc fails, try a simple syntax check
      try {
        const content = await fs.readFile(filePath, "utf-8");
        // Basic syntax validation - check for balanced braces
        const braces = { "{": 0, "[": 0, "(": 0 };
        for (const char of content) {
          if (char === "{") braces["{"]++;
          if (char === "}") braces["{"]--;
          if (char === "[") braces["["]++;
          if (char === "]") braces["["]--;
          if (char === "(") braces["("]++;
          if (char === ")") braces["("]--;
        }

        if (braces["{"] !== 0 || braces["["] !== 0 || braces["("] !== 0) {
          return { valid: false, error: "Unbalanced braces/brackets/parentheses" };
        }

        return { valid: true };
      } catch {
        return { valid: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  /**
   * Generate usage string for documentation
   */
  private generateUsageString(definition: SkillDefinition): string {
    const params = definition.parameters
      .map(p => `${p.name}: ${p.type}${p.required === false ? "?" : ""}`)
      .join(", ");
    return `${definition.name}({ ${params} })`;
  }

  /**
   * Generate parameter documentation
   */
  private generateParameterDocs(params: SkillParameter[]): string {
    return params
      .map(p => `- ${p.name} (${p.type}${p.required === false ? ", optional" : ""}): ${p.description}`)
      .join("\n");
  }

  /**
   * Sanitize skill name for use as identifier
   */
  private sanitizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }

  /**
   * Escape string for use in generated code
   */
  private escapeString(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }

  /**
   * Indent code block
   */
  private indentCode(code: string, spaces: number): string {
    const indent = " ".repeat(spaces);
    return code
      .split("\n")
      .map(line => indent + line)
      .join("\n");
  }

  /**
   * List all generated skills
   */
  async listGeneratedSkills(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dynamicDir);
      return files
        .filter(f => f.endsWith(".ts") || f.endsWith(".js"))
        .map(f => f.replace(/\.(ts|js)$/, ""));
    } catch {
      return [];
    }
  }

  /**
   * Delete a generated skill
   */
  async deleteSkill(name: string): Promise<boolean> {
    try {
      const fileName = `${this.sanitizeName(name)}.ts`;
      const filePath = path.join(this.dynamicDir, fileName);

      await fs.unlink(filePath);

      // Update registry
      await this.skillRegistryManager.updateSkillStatus(name, "deleted");

      // Unregister from tool registry if available
      if (this.toolRegistry) {
        this.toolRegistry.unregister(name);
      }

      this.logger.info({ skillName: name }, "Skill deleted");
      return true;
    } catch (err) {
      this.logger.warn({ skillName: name, error: err instanceof Error ? err.message : String(err) }, "Failed to delete skill");
      return false;
    }
  }

  /**
   * Get skill source code
   */
  async getSkillSource(name: string): Promise<string | null> {
    try {
      const fileName = `${this.sanitizeName(name)}.ts`;
      const filePath = path.join(this.dynamicDir, fileName);
      return await fs.readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }
}

/**
 * Create a skill generator instance
 */
export function createSkillGenerator(params: {
  logger: Logger;
  workspaceDir: string;
  toolRegistry?: ToolRegistry;
}): SkillGenerator {
  const dynamicDir = path.join(params.workspaceDir, "src/tools/dynamic");

  return new SkillGenerator({
    logger: params.logger,
    dynamicDir,
    workspaceDir: params.workspaceDir,
    toolRegistry: params.toolRegistry,
  });
}

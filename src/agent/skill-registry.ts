/**
 * Skill Registry Manager - Manages SKILL_REGISTRY.md
 *
 * Features:
 * - Parses existing SKILL_REGISTRY.md
 * - Adds new skills with metadata
 * - Updates skill status
 * - Generates markdown documentation
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../log.js";
import type { RegisteredSkill } from "./types.js";

/**
 * Skill status types
 */
export type SkillStatus = "active" | "deprecated" | "deleted" | "experimental";

/**
 * Skill Registry Manager class
 */
export class SkillRegistryManager {
  private readonly logger: Logger;
  private readonly registryPath: string;
  private skills: Map<string, RegisteredSkill> = new Map();
  private builtInSkills: string[] = [];
  private initialized = false;

  constructor(params: {
    logger: Logger;
    workspaceDir: string;
  }) {
    this.logger = params.logger;
    this.registryPath = path.join(params.workspaceDir, "SKILL_REGISTRY.md");
  }

  /**
   * Initialize by loading existing registry
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const content = await fs.readFile(this.registryPath, "utf-8");
      this.parseRegistry(content);
      this.initialized = true;
      this.logger.debug({ skillCount: this.skills.size }, "Skill registry loaded");
    } catch (err) {
      // Registry doesn't exist, create it
      this.logger.debug("Skill registry not found, will create on first write");
      this.initialized = true;
    }
  }

  /**
   * Parse SKILL_REGISTRY.md content
   */
  private parseRegistry(content: string): void {
    const lines = content.split("\n");
    let section: "none" | "builtin" | "discovered" = "none";
    let currentSkill: Partial<RegisteredSkill> | null = null;
    let currentField = "";

    for (const line of lines) {
      // Section headers
      if (line.includes("## Built-in Skills")) {
        section = "builtin";
        continue;
      }
      if (line.includes("## Auto-Discovered Skills")) {
        section = "discovered";
        continue;
      }

      // Built-in skills are just a list
      if (section === "builtin" && line.startsWith("- ")) {
        this.builtInSkills.push(line.slice(2).trim());
        continue;
      }

      // Discovered skills have full metadata
      if (section === "discovered") {
        // Skill header (### skill_name)
        if (line.startsWith("### ")) {
          // Save previous skill
          if (currentSkill?.name) {
            this.skills.set(currentSkill.name, currentSkill as RegisteredSkill);
          }

          currentSkill = {
            name: line.slice(4).trim(),
          };
          continue;
        }

        // Metadata fields
        if (currentSkill && line.startsWith("- **")) {
          const match = line.match(/^- \*\*([^*]+)\*\*:\s*(.*)$/);
          if (match) {
            const [, field, value] = match;
            switch (field.toLowerCase()) {
              case "created":
                currentSkill.createdAt = value;
                break;
              case "author":
                currentSkill.author = value;
                break;
              case "purpose":
                currentSkill.purpose = value;
                break;
              case "usage":
                currentSkill.usage = value;
                break;
              case "status":
                currentSkill.status = value;
                break;
              case "cron":
                currentSkill.cronSchedule = value;
                break;
            }
            currentField = field.toLowerCase();
          }
          continue;
        }

        // Parameters (multi-line)
        if (currentSkill && line.startsWith("- **Parameters**:")) {
          currentField = "parameters";
          currentSkill.parameters = "";
          continue;
        }

        if (currentSkill && currentField === "parameters" && line.startsWith("  - ")) {
          currentSkill.parameters = (currentSkill.parameters || "") + line.slice(2) + "\n";
          continue;
        }

        // Examples (multi-line)
        if (currentSkill && line.startsWith("- **Examples**:")) {
          currentField = "examples";
          currentSkill.examples = [];
          continue;
        }

        if (currentSkill && currentField === "examples" && line.startsWith("  - ")) {
          currentSkill.examples = currentSkill.examples || [];
          currentSkill.examples.push(line.slice(4).trim());
          continue;
        }
      }
    }

    // Save last skill
    if (currentSkill?.name) {
      this.skills.set(currentSkill.name, currentSkill as RegisteredSkill);
    }
  }

  /**
   * Add a new skill to the registry
   */
  async addSkill(skill: RegisteredSkill): Promise<void> {
    await this.initialize();

    this.skills.set(skill.name, skill);
    await this.saveRegistry();

    this.logger.info({ skillName: skill.name }, "Skill added to registry");
  }

  /**
   * Update skill status
   */
  async updateSkillStatus(name: string, status: SkillStatus): Promise<boolean> {
    await this.initialize();

    const skill = this.skills.get(name);
    if (!skill) {
      this.logger.warn({ skillName: name }, "Skill not found in registry");
      return false;
    }

    skill.status = status;
    await this.saveRegistry();

    this.logger.info({ skillName: name, status }, "Skill status updated");
    return true;
  }

  /**
   * Get a skill by name
   */
  async getSkill(name: string): Promise<RegisteredSkill | undefined> {
    await this.initialize();
    return this.skills.get(name);
  }

  /**
   * Get all skills
   */
  async getAllSkills(): Promise<RegisteredSkill[]> {
    await this.initialize();
    return Array.from(this.skills.values());
  }

  /**
   * Get skills by status
   */
  async getSkillsByStatus(status: SkillStatus): Promise<RegisteredSkill[]> {
    await this.initialize();
    return Array.from(this.skills.values()).filter(s => s.status === status);
  }

  /**
   * Remove a skill from registry
   */
  async removeSkill(name: string): Promise<boolean> {
    await this.initialize();

    if (!this.skills.has(name)) {
      return false;
    }

    this.skills.delete(name);
    await this.saveRegistry();

    this.logger.info({ skillName: name }, "Skill removed from registry");
    return true;
  }

  /**
   * Set built-in skills list
   */
  async setBuiltInSkills(skills: string[]): Promise<void> {
    this.builtInSkills = skills;
    await this.saveRegistry();
  }

  /**
   * Save registry to file
   */
  private async saveRegistry(): Promise<void> {
    const content = this.generateMarkdown();
    await fs.writeFile(this.registryPath, content, "utf-8");
    this.logger.debug("Skill registry saved");
  }

  /**
   * Generate markdown content for the registry
   */
  private generateMarkdown(): string {
    const lines: string[] = [
      "# Skill Registry",
      "",
      "This file tracks all available skills (tools) in the ANT CLI system.",
      "It is automatically updated when skills are created, modified, or removed.",
      "",
      "## Built-in Skills",
      "",
    ];

    // Add built-in skills
    if (this.builtInSkills.length > 0) {
      for (const skill of this.builtInSkills) {
        lines.push(`- ${skill}`);
      }
    } else {
      lines.push("*No built-in skills registered yet*");
    }

    lines.push("");
    lines.push("## Auto-Discovered Skills");
    lines.push("");

    // Add discovered skills
    const activeSkills = Array.from(this.skills.values()).filter(s => s.status !== "deleted");

    if (activeSkills.length === 0) {
      lines.push("*No auto-discovered skills yet. Skills created by the agent will appear here.*");
    } else {
      for (const skill of activeSkills) {
        lines.push(`### ${skill.name}`);
        lines.push("");
        lines.push(`- **Created**: ${skill.createdAt}`);
        lines.push(`- **Author**: ${skill.author}`);
        lines.push(`- **Purpose**: ${skill.purpose}`);
        lines.push(`- **Status**: ${skill.status || "active"}`);
        lines.push(`- **Usage**: \`${skill.usage}\``);

        if (skill.parameters) {
          lines.push("- **Parameters**:");
          for (const paramLine of skill.parameters.split("\n").filter(Boolean)) {
            lines.push(`  ${paramLine}`);
          }
        }

        if (skill.cronSchedule) {
          lines.push(`- **Cron**: \`${skill.cronSchedule}\``);
        }

        if (skill.examples && skill.examples.length > 0) {
          lines.push("- **Examples**:");
          for (const example of skill.examples) {
            lines.push(`  - ${example}`);
          }
        }

        lines.push("");
      }
    }

    lines.push("");
    lines.push("---");
    lines.push(`*Last updated: ${new Date().toISOString()}*`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Search skills by keyword
   */
  async searchSkills(query: string): Promise<RegisteredSkill[]> {
    await this.initialize();

    const lowerQuery = query.toLowerCase();
    return Array.from(this.skills.values()).filter(skill =>
      skill.name.toLowerCase().includes(lowerQuery) ||
      skill.purpose.toLowerCase().includes(lowerQuery) ||
      skill.parameters?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get registry statistics
   */
  async getStats(): Promise<{
    total: number;
    active: number;
    deprecated: number;
    experimental: number;
    builtIn: number;
  }> {
    await this.initialize();

    const skills = Array.from(this.skills.values());

    return {
      total: skills.length,
      active: skills.filter(s => s.status === "active" || !s.status).length,
      deprecated: skills.filter(s => s.status === "deprecated").length,
      experimental: skills.filter(s => s.status === "experimental").length,
      builtIn: this.builtInSkills.length,
    };
  }
}

/**
 * Create a skill registry manager instance
 */
export function createSkillRegistryManager(params: {
  logger: Logger;
  workspaceDir: string;
}): SkillRegistryManager {
  return new SkillRegistryManager(params);
}

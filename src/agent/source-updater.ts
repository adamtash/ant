/**
 * Source Updater - Source code update capability for self-improvement
 *
 * Features:
 * - Read and modify source files
 * - Verify TypeScript syntax after changes
 * - Track changes for rollback
 * - Safe file operations with backups
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "../log.js";

const execAsync = promisify(exec);

/**
 * File change record for rollback
 */
export interface FileChange {
  id: string;
  filePath: string;
  originalContent: string;
  newContent: string;
  timestamp: number;
  description: string;
  rolledBack: boolean;
}

/**
 * Update result
 */
export interface UpdateResult {
  success: boolean;
  changeId?: string;
  error?: string;
  syntaxErrors?: string[];
}

/**
 * Diff hunk for partial updates
 */
export interface DiffHunk {
  startLine: number;
  endLine: number;
  newContent: string;
}

/**
 * Source Updater class
 */
export class SourceUpdater {
  private readonly logger: Logger;
  private readonly workspaceDir: string;
  private readonly changesDir: string;
  private changes: Map<string, FileChange> = new Map();
  private readonly allowedPaths: string[];
  private readonly disallowedPatterns: RegExp[];

  constructor(params: {
    logger: Logger;
    workspaceDir: string;
    changesDir?: string;
    allowedPaths?: string[];
  }) {
    this.logger = params.logger;
    this.workspaceDir = params.workspaceDir;
    this.changesDir = params.changesDir || path.join(params.workspaceDir, ".ant/changes");

    // Default allowed paths (relative to workspace)
    this.allowedPaths = params.allowedPaths || [
      "src/",
      "test/",
      "tests/",
      "scripts/",
      "ui/",
      "SKILL_REGISTRY.md",
      "AGENT_DUTIES.md",
      "AGENT_LOG.md",
      "DRONE_FLIGHTS.md",
      "AGENTS.md",
      "PROJECT.md",
      "README.md",
      "IMPROVEMENT_LOG.md",
      "KNOWN_ISSUES.md",
      "USER_PREFERENCES.md",
      ".ant",
      ".ant/AGENT_LOG.md",
    ];

    // Patterns that should never be modified
    this.disallowedPatterns = [
      /node_modules\//,
      /\.git\//,
      /\.env/,
      /package-lock\.json/,
      /dist\//,
      /\.ant\/config/,
      /credentials/i,
      /secret/i,
      /password/i,
    ];
  }

  /**
   * Initialize the source updater
   */
  async initialize(): Promise<void> {
    // Ensure changes directory exists
    await fs.mkdir(this.changesDir, { recursive: true });

    // Load existing changes
    await this.loadChanges();

    this.logger.debug({ changesCount: this.changes.size }, "Source updater initialized");
  }

  /**
   * Read a source file
   */
  async readFile(filePath: string): Promise<string | null> {
    const absolutePath = this.resolvePath(filePath);

    if (!this.isPathAllowed(absolutePath)) {
      this.logger.warn({ filePath }, "Attempted to read disallowed path");
      return null;
    }

    try {
      return await fs.readFile(absolutePath, "utf-8");
    } catch (err) {
      this.logger.debug({ filePath, error: err instanceof Error ? err.message : String(err) }, "Failed to read file");
      return null;
    }
  }

  /**
   * Update a source file with full content replacement
   */
  async updateFile(
    filePath: string,
    newContent: string,
    description: string
  ): Promise<UpdateResult> {
    const absolutePath = this.resolvePath(filePath);

    // Security checks
    if (!this.isPathAllowed(absolutePath)) {
      return {
        success: false,
        error: `Path not allowed: ${filePath}`,
      };
    }

    try {
      // Read original content
      let originalContent = "";
      try {
        originalContent = await fs.readFile(absolutePath, "utf-8");
      } catch {
        // File doesn't exist, that's ok for new files
      }

      // Create backup/change record
      const changeId = this.generateChangeId();
      const change: FileChange = {
        id: changeId,
        filePath: absolutePath,
        originalContent,
        newContent,
        timestamp: Date.now(),
        description,
        rolledBack: false,
      };

      // Write new content
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, newContent, "utf-8");

      // Verify syntax if TypeScript
      if (absolutePath.endsWith(".ts") || absolutePath.endsWith(".tsx")) {
        const syntaxResult = await this.verifySyntax(absolutePath);
        if (!syntaxResult.valid) {
          // Rollback
          await fs.writeFile(absolutePath, originalContent, "utf-8");
          return {
            success: false,
            error: "TypeScript syntax errors",
            syntaxErrors: syntaxResult.errors,
          };
        }
      }

      // Save change record
      this.changes.set(changeId, change);
      await this.saveChange(change);

      this.logger.info({ filePath, changeId, description }, "File updated");

      return {
        success: true,
        changeId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error({ filePath, error }, "Failed to update file");
      return {
        success: false,
        error,
      };
    }
  }

  /**
   * Apply a partial update using diff hunks
   */
  async applyDiff(
    filePath: string,
    hunks: DiffHunk[],
    description: string
  ): Promise<UpdateResult> {
    const content = await this.readFile(filePath);
    if (content === null) {
      return {
        success: false,
        error: `Cannot read file: ${filePath}`,
      };
    }

    try {
      const lines = content.split("\n");

      // Sort hunks by line number (descending) to apply from bottom to top
      const sortedHunks = [...hunks].sort((a, b) => b.startLine - a.startLine);

      for (const hunk of sortedHunks) {
        const newLines = hunk.newContent.split("\n");
        lines.splice(hunk.startLine - 1, hunk.endLine - hunk.startLine + 1, ...newLines);
      }

      const newContent = lines.join("\n");
      return this.updateFile(filePath, newContent, description);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Rollback a change
   */
  async rollback(changeId: string): Promise<boolean> {
    const change = this.changes.get(changeId);
    if (!change) {
      this.logger.warn({ changeId }, "Change not found for rollback");
      return false;
    }

    if (change.rolledBack) {
      this.logger.warn({ changeId }, "Change already rolled back");
      return false;
    }

    try {
      // Restore original content
      if (change.originalContent) {
        await fs.writeFile(change.filePath, change.originalContent, "utf-8");
      } else {
        // Original was a new file, delete it
        await fs.unlink(change.filePath);
      }

      change.rolledBack = true;
      await this.saveChange(change);

      this.logger.info({ changeId, filePath: change.filePath }, "Change rolled back");
      return true;
    } catch (err) {
      this.logger.error(
        { changeId, error: err instanceof Error ? err.message : String(err) },
        "Failed to rollback change"
      );
      return false;
    }
  }

  /**
   * Rollback all changes since a timestamp
   */
  async rollbackSince(timestamp: number): Promise<number> {
    const changesToRollback = Array.from(this.changes.values())
      .filter(c => c.timestamp >= timestamp && !c.rolledBack)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

    let rolledBack = 0;
    for (const change of changesToRollback) {
      if (await this.rollback(change.id)) {
        rolledBack++;
      }
    }

    this.logger.info({ count: rolledBack, since: new Date(timestamp).toISOString() }, "Batch rollback complete");
    return rolledBack;
  }

  /**
   * Get change history
   */
  getChanges(limit = 50): FileChange[] {
    return Array.from(this.changes.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get a specific change
   */
  getChange(changeId: string): FileChange | undefined {
    return this.changes.get(changeId);
  }

  /**
   * Verify TypeScript syntax
   */
  private async verifySyntax(filePath: string): Promise<{ valid: boolean; errors?: string[] }> {
    try {
      const tsconfigPath = path.join(this.workspaceDir, "tsconfig.json");
      const cmd = `npx tsc --noEmit --skipLibCheck "${filePath}" --project "${tsconfigPath}" 2>&1`;

      const { stdout, stderr } = await execAsync(cmd, {
        cwd: this.workspaceDir,
        timeout: 300000,
      });

      const output = stdout + stderr;

      if (output.includes("error TS")) {
        const errors = output
          .split("\n")
          .filter(line => line.includes("error TS"))
          .slice(0, 5);
        return { valid: false, errors };
      }

      return { valid: true };
    } catch (err) {
      // tsc returns non-zero on errors
      const output = (err as { stdout?: string; stderr?: string }).stdout || "";
      const errors = output
        .split("\n")
        .filter(line => line.includes("error TS"))
        .slice(0, 5);

      if (errors.length > 0) {
        return { valid: false, errors };
      }

      // Unknown error, assume valid
      return { valid: true };
    }
  }

  /**
   * Check if a path is allowed for modification
   */
  private isPathAllowed(absolutePath: string): boolean {
    // Must be within workspace
    if (!absolutePath.startsWith(this.workspaceDir)) {
      return false;
    }

    const relativePath = path.relative(this.workspaceDir, absolutePath);

    // Check disallowed patterns
    for (const pattern of this.disallowedPatterns) {
      if (pattern.test(relativePath)) {
        return false;
      }
    }

    // Check allowed paths
    for (const allowed of this.allowedPaths) {
      if (relativePath.startsWith(allowed) || relativePath === allowed) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolve a path (relative or absolute) to absolute
   */
  private resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.workspaceDir, filePath);
  }

  /**
   * Generate a unique change ID
   */
  private generateChangeId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${random}`;
  }

  /**
   * Save a change record to disk
   */
  private async saveChange(change: FileChange): Promise<void> {
    const changeFile = path.join(this.changesDir, `${change.id}.json`);
    await fs.writeFile(changeFile, JSON.stringify(change, null, 2), "utf-8");
  }

  /**
   * Load existing changes from disk
   */
  private async loadChanges(): Promise<void> {
    try {
      const files = await fs.readdir(this.changesDir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await fs.readFile(path.join(this.changesDir, file), "utf-8");
          const change = JSON.parse(content) as FileChange;
          this.changes.set(change.id, change);
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  /**
   * Clean up old change records
   */
  async cleanupOldChanges(maxAgeDays = 30): Promise<number> {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [id, change] of this.changes) {
      if (change.timestamp < cutoff) {
        const changeFile = path.join(this.changesDir, `${id}.json`);
        try {
          await fs.unlink(changeFile);
          this.changes.delete(id);
          cleaned++;
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    this.logger.debug({ cleaned }, "Cleaned up old changes");
    return cleaned;
  }

  /**
   * Get diff between two contents
   */
  getDiff(original: string, modified: string): string {
    const originalLines = original.split("\n");
    const modifiedLines = modified.split("\n");
    const diff: string[] = [];

    let i = 0;
    let j = 0;

    while (i < originalLines.length || j < modifiedLines.length) {
      if (i >= originalLines.length) {
        diff.push(`+ ${modifiedLines[j]}`);
        j++;
      } else if (j >= modifiedLines.length) {
        diff.push(`- ${originalLines[i]}`);
        i++;
      } else if (originalLines[i] === modifiedLines[j]) {
        diff.push(`  ${originalLines[i]}`);
        i++;
        j++;
      } else {
        diff.push(`- ${originalLines[i]}`);
        diff.push(`+ ${modifiedLines[j]}`);
        i++;
        j++;
      }
    }

    return diff.join("\n");
  }
}

/**
 * Create a source updater instance
 */
export function createSourceUpdater(params: {
  logger: Logger;
  workspaceDir: string;
}): SourceUpdater {
  return new SourceUpdater(params);
}

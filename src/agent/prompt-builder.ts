/**
 * Prompt Builder - Constructs system prompts for the agent
 *
 * Features:
 * - Dynamic system prompt construction
 * - Tool documentation injection
 * - Memory context integration
 * - Bootstrap files loading
 * - Provider-specific formatting
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, CronContext, AgentConfig, Message } from "./types.js";

/**
 * Runtime info for prompt building
 */
export interface RuntimeInfo {
  model: string;
  providerType: "openai" | "cli";
  workspaceDir: string;
  currentTime: Date;
  cronContext?: CronContext;
}

/**
 * Memory context for prompt injection
 */
export interface MemoryContext {
  recentMemory: string[];
  relevantContext: string[];
}

/**
 * Prompt builder options
 */
export interface PromptBuilderOptions {
  config: AgentConfig;
  tools: ToolDefinition[];
  bootstrapFiles: BootstrapFile[];
  runtimeInfo: RuntimeInfo;
  memoryContext?: MemoryContext;
  isSubagent?: boolean;
}

/**
 * Bootstrap file structure
 */
export interface BootstrapFile {
  name: string;
  path: string;
  content: string;
}

/**
 * Build the complete system prompt
 */
export function buildSystemPrompt(options: PromptBuilderOptions): string {
  const sections: string[] = [];

  // Core identity
  sections.push(buildIdentitySection(options));

  // Runtime info
  sections.push(buildRuntimeSection(options.runtimeInfo));

  // Tools documentation
  if (options.tools.length > 0) {
    sections.push(buildToolsSection(options.tools));
  }

  // Memory context
  if (options.memoryContext) {
    sections.push(buildMemorySection(options.memoryContext));
  }

  // Bootstrap files (MEMORY.md, PROJECT.md, etc.)
  if (options.bootstrapFiles.length > 0) {
    sections.push(buildBootstrapSection(options.bootstrapFiles));
  }

  // Cron context if triggered by schedule
  if (options.runtimeInfo.cronContext) {
    sections.push(buildCronSection(options.runtimeInfo.cronContext));
  }

  // Guidelines
  sections.push(buildGuidelinesSection(options.isSubagent));

  return sections.filter(Boolean).join("\n\n---\n\n");
}

/**
 * Build identity section
 */
function buildIdentitySection(options: PromptBuilderOptions): string {
  const customPrompt = options.config.systemPrompt?.trim();

  const baseIdentity = `# ANT - Autonomous Agent

You are ANT, an autonomous AI agent that helps users accomplish tasks. You have access to tools for file operations, shell commands, browser control, memory search, and more.

Key capabilities:
- Execute shell commands and scripts
- Read, write, and modify files
- Control browser for web tasks
- Search and update long-term memory
- Spawn subagents for parallel tasks
- Send messages across channels (WhatsApp, CLI, Web)`;

  if (customPrompt) {
    return `${baseIdentity}\n\n## Custom Instructions\n\n${customPrompt}`;
  }

  return baseIdentity;
}

/**
 * Build runtime info section
 */
function buildRuntimeSection(runtimeInfo: RuntimeInfo): string {
  return `# Runtime Information

- **Current Time**: ${runtimeInfo.currentTime.toISOString()}
- **Model**: ${runtimeInfo.model}
- **Provider**: ${runtimeInfo.providerType}
- **Workspace**: ${runtimeInfo.workspaceDir}`;
}

/**
 * Build tools documentation section
 */
function buildToolsSection(tools: ToolDefinition[]): string {
  const toolDocs = tools.map(tool => {
    const params = tool.function.parameters.properties
      ? Object.entries(tool.function.parameters.properties as Record<string, { type: string; description?: string }>)
          .map(([name, schema]) => `  - \`${name}\` (${schema.type}): ${schema.description || ""}`)
          .join("\n")
      : "  (no parameters)";

    const required = tool.function.parameters.required?.join(", ") || "none";

    return `### ${tool.function.name}

${tool.function.description}

**Parameters:**
${params}

**Required:** ${required}`;
  }).join("\n\n");

  return `# Available Tools

You can use the following tools to accomplish tasks. Call tools using the standard function calling format.

${toolDocs}`;
}

/**
 * Build memory context section
 */
function buildMemorySection(memoryContext: MemoryContext): string {
  const sections: string[] = ["# Memory Context"];

  if (memoryContext.recentMemory.length > 0) {
    sections.push("## Recent Memory\n\n" + memoryContext.recentMemory.join("\n"));
  }

  if (memoryContext.relevantContext.length > 0) {
    sections.push("## Relevant Context\n\n" + memoryContext.relevantContext.join("\n"));
  }

  return sections.join("\n\n");
}

/**
 * Build bootstrap files section
 */
function buildBootstrapSection(files: BootstrapFile[]): string {
  const fileSections = files.map(file => {
    return `### ${file.name}

\`\`\`
${file.content}
\`\`\``;
  }).join("\n\n");

  return `# Project Context

${fileSections}`;
}

/**
 * Build cron context section
 */
function buildCronSection(cronContext: CronContext): string {
  return `# Scheduled Task Context

This task was triggered by a scheduled job:
- **Job ID**: ${cronContext.jobId}
- **Job Name**: ${cronContext.jobName}
- **Schedule**: ${cronContext.schedule}
- **Triggered At**: ${new Date(cronContext.triggeredAt).toISOString()}

You are running autonomously. Complete the scheduled task and report results.`;
}

/**
 * Build guidelines section
 */
function buildGuidelinesSection(isSubagent?: boolean): string {
  const baseGuidelines = `# Guidelines

1. **Be concise** - Keep responses focused and actionable
2. **Use tools effectively** - Prefer using tools over asking for information you can look up
3. **Handle errors gracefully** - If a tool fails, try alternatives or explain the issue clearly
4. **Respect workspace boundaries** - Work within the configured workspace directory
5. **Preserve context** - Reference previous conversation when relevant
6. **Report progress** - For long tasks, provide updates on progress`;

  if (isSubagent) {
    return `${baseGuidelines}

## Subagent Guidelines

You are running as a subagent (parallel task). Your output will be collected and returned to the parent agent. Focus on completing your assigned task efficiently.`;
  }

  return baseGuidelines;
}

/**
 * Load bootstrap files from workspace
 */
export async function loadBootstrapFiles(params: {
  workspaceDir: string;
  isSubagent?: boolean;
}): Promise<BootstrapFile[]> {
  const files: BootstrapFile[] = [];

  // Files to load in order of priority
  const fileNames = [
    "MEMORY.md",
    "PROJECT.md",
    "AGENTS.md",
    "SKILL_REGISTRY.md",
    "AGENT_LOG.md"
  ];

  // For subagents, only load essential files
  const filesToLoad = params.isSubagent
    ? ["PROJECT.md", "SKILL_REGISTRY.md"]
    : fileNames;

  for (const fileName of filesToLoad) {
    const filePath = path.join(params.workspaceDir, fileName);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      if (content.trim()) {
        files.push({
          name: fileName,
          path: filePath,
          content: truncateContent(content, 4000),
        });
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  // Also check memory directory
  const memoryDir = path.join(params.workspaceDir, "memory");
  try {
    const memoryFiles = await fs.readdir(memoryDir);
    for (const file of memoryFiles.slice(0, 3)) { // Limit to 3 memory files
      if (file.endsWith(".md")) {
        const filePath = path.join(memoryDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        if (content.trim()) {
          files.push({
            name: `memory/${file}`,
            path: filePath,
            content: truncateContent(content, 2000),
          });
        }
      }
    }
  } catch {
    // Memory directory doesn't exist, skip
  }

  return files;
}

/**
 * Truncate content to a maximum length
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;

  const truncated = content.slice(0, maxLength);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxLength * 0.8) {
    return truncated.slice(0, lastNewline) + "\n\n...[truncated]";
  }

  return truncated + "\n\n...[truncated]";
}

/**
 * Estimate tokens in a prompt (rough approximation with safety margin)
 * Using 1.2x safety factor per openclaw's approach to avoid overrunning context
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const SAFETY_MARGIN = 1.2; // 20% buffer for inaccuracy
  return Math.ceil((text.length / 4) * SAFETY_MARGIN);
}

/**
 * Trim messages to fit within token budget
 */
export function trimMessagesForContext(
  messages: Message[],
  maxTokens: number
): Message[] {
  const tokenBudget = Math.max(2048, maxTokens - 1024);
  let total = 0;
  const reversed = [...messages].reverse();
  const kept: Message[] = [];
  const compactPlaceholder = "[Old tool result content cleared]";

  for (const msg of reversed) {
    let candidate = msg;
    let tokenEstimate = estimateTokens(candidate.content ?? "");

    if (kept.length === 0 || total + tokenEstimate <= tokenBudget) {
      kept.push(candidate);
      total += tokenEstimate;
      continue;
    }

    if (msg.role === "tool" && msg.content && msg.content.length > 4000 && !msg.metadata?.compacted) {
      candidate = {
        ...msg,
        content: compactPlaceholder,
        metadata: {
          ...(msg.metadata ?? {}),
          compacted: Date.now(),
          originalLength: msg.content.length,
        },
      };
      tokenEstimate = estimateTokens(candidate.content ?? "");
      if (total + tokenEstimate <= tokenBudget) {
        kept.push(candidate);
        total += tokenEstimate;
        continue;
      }
    }

    break;
  }

  const trimmed = kept.reverse();

  // Ensure system prompt stays first if present
  const system = messages.find((msg) => msg.role === "system");
  if (system && trimmed[0]?.role !== "system") {
    return [system, ...trimmed.filter((msg) => msg.role !== "system")];
  }

  return trimmed;
}

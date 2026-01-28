import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../config.js";
import type { Logger } from "../log.js";
import type { MemoryManager } from "../memory/index.js";
import { buildSystemPrompt, loadBootstrapFiles } from "./prompt.js";
import { splitMediaFromOutput } from "./media.js";
import type { SessionStore } from "./session-store.js";
import type { SubagentManager } from "./subagents.js";
import type { Tool, ToolContext } from "./tools.js";
import { buildTools } from "./tools.js";
import type { InboundMessage } from "./context.js";
import type { OpenAIMessage, OpenAIToolDefinition } from "./openai.js";
import { runCliProvider } from "./cli-tools.js";
import { ProviderClients, type ResolvedProvider } from "./providers.js";

export class AgentRunner {
  private readonly cfg: AntConfig;
  private readonly logger: Logger;
  private readonly providers: ProviderClients;
  private readonly memory: MemoryManager;
  private readonly sessions: SessionStore;
  private readonly subagents: SubagentManager;
  private readonly sendMessage: (chatId: string, text: string) => Promise<void>;
  private readonly sendMedia: (
    chatId: string,
    payload: { filePath: string; type?: "image" | "video" | "document"; caption?: string },
  ) => Promise<void>;

  constructor(params: {
    cfg: AntConfig;
    logger: Logger;
    providers: ProviderClients;
    memory: MemoryManager;
    sessions: SessionStore;
    subagents: SubagentManager;
    sendMessage: (chatId: string, text: string) => Promise<void>;
    sendMedia: (
      chatId: string,
      payload: { filePath: string; type?: "image" | "video" | "document"; caption?: string },
    ) => Promise<void>;
  }) {
    this.cfg = params.cfg;
    this.logger = params.logger;
    this.providers = params.providers;
    this.memory = params.memory;
    this.sessions = params.sessions;
    this.subagents = params.subagents;
    this.sendMessage = params.sendMessage;
    this.sendMedia = params.sendMedia;
  }

  async runInboundMessage(message: InboundMessage): Promise<string> {
    const sessionKey = message.sessionKey;
    this.sessions.setSessionContext(sessionKey, {
      sessionKey,
      lastChannel: "whatsapp",
      lastChatId: message.chatId,
    });

    const memoryAck = await this.handleMemoryCommand(message);
    if (memoryAck) {
      await this.sessions.appendMessage(sessionKey, {
        role: "user",
        content: message.text,
        ts: message.timestamp,
      });
      await this.sessions.appendMessage(sessionKey, {
        role: "assistant",
        content: memoryAck,
        ts: Date.now(),
      });
      return memoryAck;
    }

    const response = await this.runTask({
      sessionKey,
      task: message.text,
      isSubagent: false,
      requesterChatId: message.chatId,
    });

    await this.sessions.appendMessage(sessionKey, {
      role: "user",
      content: message.text,
      ts: message.timestamp,
    });

    await this.sessions.appendMessage(sessionKey, {
      role: "assistant",
      content: response,
      ts: Date.now(),
    });

    return response;
  }

  private async handleMemoryCommand(message: InboundMessage): Promise<string | null> {
    const command = isMemoryCommand(message.text);
    if (!command) return null;
    if (!command.note) {
      return "Usage: /memory <note> or /remember <note>";
    }
    try {
      await appendMemoryNote(this.cfg.resolved.workspaceDir, command.note);
      await this.memory.indexAll().catch(() => {});
      return "Saved to MEMORY.md.";
    } catch (err) {
      return `Failed to save memory: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async runTask(params: {
    sessionKey: string;
    task: string;
    isSubagent: boolean;
    requesterChatId?: string;
  }): Promise<string> {
    const history = await this.sessions.readMessages(params.sessionKey);
    const toolContext: ToolContext = {
      cfg: this.cfg,
      logger: this.logger,
      memory: this.memory,
      sessions: this.sessions,
      subagents: this.subagents,
      sendMessage: this.sendMessage,
      sendMedia: this.sendMedia,
      requester: params.requesterChatId
        ? { sessionKey: params.sessionKey, chatId: params.requesterChatId }
        : undefined,
    };
    const tools = buildTools(toolContext);
    const fastPath = await tryDirectToolHandling({
      task: params.task,
      tools,
      ctx: toolContext,
      logger: this.logger,
    });
    if (fastPath) {
      return fastPath;
    }
    let toolProvider = this.providers.resolveProvider("tools");
    const chatProvider = this.providers.resolveProvider("chat");
    const parentProvider = this.resolveParentProvider(toolProvider);
    if (toolProvider.type !== "openai") {
      this.logger.warn(
        { toolProvider: toolProvider.id, fallbackProvider: parentProvider.id },
        "tools provider is not openai-capable; falling back to parent provider",
      );
      toolProvider = parentProvider;
    }
    const toolPromptProvider = chatProvider.type === "cli" ? parentProvider : chatProvider;
    const toolPromptProviderType: "openai" | "cli" =
      chatProvider.type === "cli" ? "openai" : chatProvider.type;

    const bootstrapFiles = await loadBootstrapFiles({
      workspaceDir: this.cfg.resolved.workspaceDir,
      isSubagent: params.isSubagent,
      providerType: toolPromptProviderType,
    });
    const toolDescriptors = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    const systemPromptForTools = buildSystemPrompt({
      systemPrompt: this.cfg.agent.systemPrompt,
      tools: toolDescriptors,
      bootstrapFiles,
      runtimeInfo: {
        model: toolPromptProvider.modelForAction,
        providerBaseUrl: toolPromptProvider.baseUrl ?? "",
        providerType: toolPromptProviderType,
        workspaceDir: this.cfg.resolved.workspaceDir,
      },
      isSubagent: params.isSubagent,
    });
    const systemPromptForCli = buildSystemPrompt({
      systemPrompt: this.cfg.agent.systemPrompt,
      tools: [],
      bootstrapFiles,
      runtimeInfo: {
        model: chatProvider.modelForAction,
        providerBaseUrl: chatProvider.baseUrl ?? "",
        providerType: "cli",
        workspaceDir: this.cfg.resolved.workspaceDir,
      },
      isSubagent: params.isSubagent,
    });

    const messages: OpenAIMessage[] = [
      { role: "system", content: systemPromptForTools },
      ...history.map((msg) => ({
        role: msg.role,
        content: msg.content,
        tool_call_id: msg.toolCallId,
        name: msg.name,
      })),
      { role: "user", content: params.task },
    ];

    const maxTokens = Math.min(
      chatProvider.contextWindow ?? this.cfg.agent.maxHistoryTokens,
      this.cfg.agent.maxHistoryTokens,
    );
    const trimmed = trimForContext(messages, maxTokens);
    const response = await this.runWithProviders({
      chatProvider,
      toolProvider,
      parentProvider,
      tools,
      messages: trimmed,
      systemPromptForCli,
    });

    if (params.isSubagent) {
      await this.sessions.appendMessage(params.sessionKey, {
        role: "user",
        content: params.task,
        ts: Date.now(),
      });
      await this.sessions.appendMessage(params.sessionKey, {
        role: "assistant",
        content: response,
        ts: Date.now(),
      });
    }

    return response;
  }

  private async runWithProviders(params: {
    chatProvider: ResolvedProvider;
    toolProvider: ResolvedProvider;
    parentProvider: ResolvedProvider;
    tools: Tool[];
    messages: OpenAIMessage[];
    systemPromptForCli: string;
  }): Promise<string> {
    if (params.chatProvider.type === "openai" && params.chatProvider.id === params.toolProvider.id) {
      const result = await this.runToolLoop({
        provider: params.chatProvider,
        messages: params.messages,
        tools: params.tools,
        mode: "final",
      });
      const toolMedia = extractMediaFromToolMessages(result.messages);
      return appendMediaTokens(result.final ?? "", toolMedia);
    }

    if (params.chatProvider.type === "openai") {
      const toolResult = await this.runToolLoop({
        provider: params.toolProvider,
        messages: params.messages,
        tools: params.tools,
        mode: "tools-only",
      });
      const final = await this.runOpenAiFinal({
        provider: params.chatProvider,
        messages: toolResult.messages,
      });
      const toolMedia = extractMediaFromToolMessages(toolResult.messages);
      return appendMediaTokens(final, toolMedia);
    }

    const toolResult = await this.runToolLoop({
      provider: params.parentProvider,
      messages: params.messages,
      tools: params.tools,
      mode: "tools-only",
    });
    const toolSummary = collectToolOutputs(toolResult.messages);
    const memorySummary = await this.buildMemorySummaryForCli(params.messages);
    const prompt = buildCliPromptFromTools({
      systemPrompt: params.systemPromptForCli,
      messages: params.messages,
      toolSummary,
      memorySummary,
    });
    const cliResult = await this.runWithCliProvider(prompt, params.chatProvider);
    const toolMedia = extractMediaFromToolMessages(toolResult.messages);
    return appendMediaTokens(cliResult, toolMedia);
  }

  private async runToolLoop(params: {
    provider: ResolvedProvider;
    messages: OpenAIMessage[];
    tools: Tool[];
    mode: "final" | "tools-only";
  }): Promise<{ messages: OpenAIMessage[]; final?: string }> {
    const toolDefs: OpenAIToolDefinition[] = params.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    let loopMessages = params.messages.slice();
    const client = this.providers.getOpenAiClient(params.provider.id);
    for (let i = 0; i < 6; i += 1) {
      const res = await client.chat({
        model: params.provider.modelForAction,
        messages: loopMessages,
        tools: toolDefs,
        toolChoice: "auto",
        temperature: this.cfg.agent.temperature,
      });
      const message = res.message;
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const final = stripReasoning(message.content ?? "");
        if (params.mode === "final") {
          return { messages: loopMessages, final };
        }
        loopMessages.push({
          role: "assistant",
          content: message.content ?? "",
        });
        return { messages: loopMessages, final };
      }

      loopMessages.push({
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const tool = params.tools.find((entry) => entry.name === call.function.name);
        if (!tool) {
          loopMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "unknown tool" }),
          });
          continue;
        }
        try {
          this.logger.debug({ tool: call.function.name, toolCallId: call.id }, "tool call start");
          const result = await tool.execute(call.function.arguments, {
            cfg: this.cfg,
            logger: this.logger,
            memory: this.memory,
            sessions: this.sessions,
            subagents: this.subagents,
            sendMessage: this.sendMessage,
            sendMedia: this.sendMedia,
          });
          this.logger.debug({ tool: call.function.name, toolCallId: call.id }, "tool call complete");
          loopMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content,
          });
        } catch (err) {
          this.logger.warn(
            { tool: call.function.name, toolCallId: call.id, error: err instanceof Error ? err.message : String(err) },
            "tool call failed",
          );
          loopMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          });
        }
      }
    }

    return { messages: loopMessages, final: "Tool loop exceeded." };
  }

  private async runOpenAiFinal(params: {
    provider: ResolvedProvider;
    messages: OpenAIMessage[];
  }): Promise<string> {
    const client = this.providers.getOpenAiClient(params.provider.id);
    const res = await client.chat({
      model: params.provider.modelForAction,
      messages: params.messages,
      temperature: this.cfg.agent.temperature,
    });
    return stripReasoning(res.message.content ?? "");
  }

  private async runWithCliProvider(prompt: string, provider: ResolvedProvider): Promise<string> {
    const result = await runCliProvider({
      cfg: this.cfg,
      provider: provider.cliProvider,
      prompt,
    });
    if (!result.ok) {
      return `CLI provider failed: ${result.stderr || "unknown error"}`;
    }
    return stripReasoning(result.output);
  }

  private resolveParentProvider(toolProvider: ResolvedProvider): ResolvedProvider {
    const parentId = this.cfg.resolved.routing.parentForCli ?? toolProvider.id;
    if (!this.cfg.resolved.routing.parentForCli && toolProvider.type !== "openai") {
      const fallbackId = this.cfg.resolved.providers.default;
      return this.providers.resolveProviderById(fallbackId, "tools");
    }
    return this.providers.resolveProviderById(parentId, "tools");
  }

  private async buildMemorySummaryForCli(messages: OpenAIMessage[]): Promise<string> {
    if (!this.cfg.memory.enabled) return "";
    const query = lastUserMessage(messages).trim();
    if (!query) return "";
    try {
      const results = await this.memory.search(query, 4);
      if (!results.length) return "";
      return results
        .map(
          (result) =>
            `- ${result.path}:${result.startLine}-${result.endLine} (score ${result.score.toFixed(2)})\n` +
            `${result.snippet.trim()}`,
        )
        .join("\n");
    } catch (err) {
      this.logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        "memory summary failed",
      );
      return "";
    }
  }
}

function trimForContext(messages: OpenAIMessage[], maxTokens: number): OpenAIMessage[] {
  const tokenBudget = Math.max(2048, maxTokens - 1024);
  let total = 0;
  const reversed = [...messages].reverse();
  const kept: OpenAIMessage[] = [];
  for (const msg of reversed) {
    const tokenEstimate = estimateTokens(msg.content ?? "");
    if (kept.length === 0 || total + tokenEstimate <= tokenBudget) {
      kept.push(msg);
      total += tokenEstimate;
    } else {
      break;
    }
  }
  const trimmed = kept.reverse();
  // Ensure system prompt stays first if present
  const system = messages.find((msg) => msg.role === "system");
  if (system && trimmed[0]?.role !== "system") {
    return [system, ...trimmed.filter((msg) => msg.role !== "system")];
  }
  return trimmed;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function stripReasoning(text: string): string {
  if (!text) return text;
  const endTag = "</think>";
  const idx = text.lastIndexOf(endTag);
  if (idx !== -1) {
    return text.slice(idx + endTag.length).trim();
  }
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function buildCliPromptFromTools(params: {
  systemPrompt: string;
  messages: OpenAIMessage[];
  toolSummary: string;
  memorySummary?: string;
}): string {
  const userMessage = lastUserMessage(params.messages);
  const history = formatHistory(params.messages, { excludeLastUser: true });
  const sections = [
    `System:\n${params.systemPrompt}`,
    history ? `Conversation:\n${history}` : "",
    params.memorySummary ? `Memory Recall:\n${params.memorySummary}` : "",
    params.toolSummary ? `Tool results:\n${params.toolSummary}` : "",
    `User:\n${userMessage}`,
    "Assistant:",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function collectToolOutputs(messages: OpenAIMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    if (!msg.content) continue;
    lines.push(String(msg.content).trim());
  }
  return lines.join("\n\n");
}

function lastUserMessage(messages: OpenAIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role === "user" && msg.content) return msg.content;
  }
  return "";
}

async function tryDirectToolHandling(params: {
  task: string;
  tools: Tool[];
  ctx: ToolContext;
  logger: Logger;
}): Promise<string | null> {
  const raw = params.task.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (lower.startsWith("open ")) {
    const match = raw.match(/^open\s+(.+?)(?:\s+app|\s+application)?$/i);
    if (match) {
      let appName = match[1].trim();
      appName = appName.replace(/\s+(on|in)\s+mac(?:os)?$/i, "").trim();
      if (appName) {
        const tool = params.tools.find((entry) => entry.name === "open_app");
        if (tool) {
          params.logger.debug({ appName }, "direct tool: open_app");
          const result = await tool.execute(JSON.stringify({ name: appName }), params.ctx);
          const payload = safeParseJson(result.content);
          if (payload?.ok === false) {
            const error = payload.error ?? "unknown error";
            return `Failed to open ${appName}: ${error}`;
          }
          return `Opened ${appName}.`;
        }
      }
    }
  }

  if (lower.includes("restart ant")) {
    const tool = params.tools.find((entry) => entry.name === "restart_ant");
    if (tool) {
      params.logger.debug("direct tool: restart_ant");
      await tool.execute("{}", params.ctx);
      return "Restarting ant now.";
    }
  }

  return null;
}

function formatHistory(
  messages: OpenAIMessage[],
  opts: { excludeLastUser?: boolean } = {},
): string {
  const lastUser = opts.excludeLastUser ? lastUserMessage(messages) : "";
  const lines: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "tool") continue;
    const content = msg.content?.trim();
    if (!content) continue;
    if (opts.excludeLastUser && msg.role === "user" && content === lastUser) {
      continue;
    }
    const label = msg.role === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${content}`);
  }
  return lines.join("\n");
}

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractMediaFromToolMessages(messages: OpenAIMessage[]): string[] {
  const media: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    if (!msg.content) continue;
    const split = splitMediaFromOutput(String(msg.content));
    if (split.mediaUrls?.length) {
      media.push(...split.mediaUrls);
    }
  }
  return [...new Set(media)];
}

function appendMediaTokens(text: string, media: string[]): string {
  if (!media.length) return text;
  const split = splitMediaFromOutput(text ?? "");
  const existing = new Set(split.mediaUrls ?? []);
  const extra = media.filter((item) => !existing.has(item));
  if (extra.length === 0) return text ?? "";
  const suffix = extra.map((item) => `MEDIA:${item}`).join("\n");
  const base = (text ?? "").trim();
  return base ? `${base}\n${suffix}` : suffix;
}

function isMemoryCommand(text: string): { note: string } | null {
  const trimmed = text.trim();
  if (trimmed.toLowerCase() === "/memory" || trimmed.toLowerCase() === "/remember") {
    return { note: "" };
  }
  for (const prefix of ["/memory", "/remember"]) {
    if (trimmed.toLowerCase().startsWith(prefix)) {
      return { note: trimmed.slice(prefix.length).trim() };
    }
  }
  return null;
}

async function appendMemoryNote(workspaceDir: string, note: string): Promise<void> {
  const filePath = path.join(workspaceDir, "MEMORY.md");
  const date = new Date().toISOString().slice(0, 10);
  const line = `- [${date}] ${note}`.trim();
  const content = `${line}\n`;
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.appendFile(filePath, content, "utf-8");
}

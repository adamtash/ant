import fs from "node:fs/promises";
import path from "node:path";

export type ToolDescriptor = {
  name: string;
  description: string;
};

export type BootstrapFile = {
  name: string;
  path: string;
  content?: string;
};

const SUBAGENT_ALLOWLIST = new Set(["AGENTS.md", "TOOLS.md"]);

export async function loadBootstrapFiles(params: {
  workspaceDir: string;
  isSubagent: boolean;
  providerType?: "openai" | "cli";
}): Promise<BootstrapFile[]> {
  const files = [
    "AGENTS.md",
    "TOOLS.md",
    "USER.md",
    "BOOTSTRAP.md",
    "MEMORY.md",
    "memory.md",
  ];
  const entries: BootstrapFile[] = [];
  for (const name of files) {
    if (params.isSubagent && !SUBAGENT_ALLOWLIST.has(name)) continue;
    const filePath = path.join(params.workspaceDir, name);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      entries.push({ name, path: filePath, content });
    } catch {
      // optional
    }
  }

  if (!params.isSubagent && params.providerType !== "cli") {
    const memoryDir = path.join(params.workspaceDir, "memory");
    try {
      const names = await fs.readdir(memoryDir);
      for (const name of names) {
        if (!name.endsWith(".md")) continue;
        const filePath = path.join(memoryDir, name);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          entries.push({ name: `memory/${name}`, path: filePath, content });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  return entries;
}

export function buildSystemPrompt(params: {
  systemPrompt?: string;
  tools: ToolDescriptor[];
  bootstrapFiles: BootstrapFile[];
  runtimeInfo: {
    model: string;
    providerBaseUrl: string;
    providerType: "openai" | "cli";
    workspaceDir: string;
  };
  isSubagent: boolean;
}): string {
  const lines: string[] = [];
  lines.push("You are ant, an autonomous assistant.");
  lines.push("Respond with final answers only. Do not include chain-of-thought or reasoning.");
  if (params.runtimeInfo.providerType === "cli") {
    lines.push(
      "You cannot call tools directly; a parent model may have already executed tools for you.",
    );
    lines.push(
      "Never claim you lack access to the system, files, or browser. Use any tool results provided below.",
    );
    lines.push(
      "If an action is requested and no tool results are present, ask a brief clarifying question or ask to retry.",
    );
  }
  lines.push("");

  if (params.systemPrompt?.trim()) {
    lines.push(params.systemPrompt.trim());
    lines.push("");
  }

  if (params.tools.length > 0) {
    lines.push("## Tooling");
    lines.push("Call tools whenever they are needed to fulfill the user’s request.");
    lines.push("Never claim an action is impossible without first attempting a relevant tool.");
    lines.push("Never fabricate tool results.");
    lines.push("For macOS app launches, prefer open_app with the application name.");
    lines.push("Tool names are case-sensitive; call them exactly as listed.");
    for (const tool of params.tools) {
      lines.push(`- ${tool.name}: ${tool.description}`);
    }
    lines.push("");
  }

  if (!params.isSubagent && params.runtimeInfo.providerType !== "cli") {
    lines.push("## Memory Recall");
    lines.push(
      "Before answering questions about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md + session transcripts. Then use memory_get for precise lines.",
    );
    lines.push("");
  }

  if (!params.isSubagent) {
    lines.push("## Missing Features");
    lines.push(
      "If the user asks for something that is not possible yet, say so clearly, suggest viable alternatives, and offer to implement the missing feature.",
    );
    lines.push(
      "When the solution requires code/config changes or multi-step work: propose the plan and ask for confirmation before making changes. After confirmation, proceed without asking again.",
    );
    lines.push("");
  }

  if (!params.isSubagent) {
    lines.push("## Subagents");
    lines.push(
      "If a task is complex or parallelizable, use sessions_spawn to delegate. Subagents will report back when done.",
    );
    lines.push("");
  }

  if (!params.isSubagent) {
    lines.push("## Messaging");
    lines.push("Replying normally sends a message to the current WhatsApp chat.");
    lines.push("Use sessions_send to message another session.");
    lines.push("Use message_send for proactive WhatsApp messages to a specific chat id.");
    lines.push("");
  }

  lines.push("## Runtime");
  lines.push(`Model: ${params.runtimeInfo.model}`);
  lines.push(`Provider: ${params.runtimeInfo.providerBaseUrl || "n/a"}`);
  lines.push(`Workspace: ${params.runtimeInfo.workspaceDir}`);
  lines.push("");

  if (params.bootstrapFiles.length > 0) {
    lines.push("## Project Context");
    for (const file of params.bootstrapFiles) {
      lines.push(`### ${file.name}`);
      lines.push(file.content ?? "");
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}

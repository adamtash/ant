import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

import type { AntConfig } from "../config.js";
import { MemoryManager } from "../memory/index.js";
import { ProviderClients } from "../runtime/providers.js";

export async function runMcpServer(cfg: AntConfig): Promise<void> {
  const providers = new ProviderClients(cfg);
  const { provider, client } = providers.getEmbeddingProvider();
  const memory = new MemoryManager({
    cfg,
    client,
    embeddingModel: provider.models?.embeddings ?? provider.embeddingsModel ?? provider.model,
  });

  const allowedTools = new Set(cfg.cliTools.mcp.tools);

  const server = new Server(
    { name: "ant-mcp", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [] as Array<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
    }>;
    if (allowedTools.has("memory_search")) {
      tools.push({
        name: "memory_search",
        description:
          "Search MEMORY.md + memory/*.md + session transcripts for relevant context. Returns snippets with path + line numbers.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            maxResults: { type: "number" },
            minScore: { type: "number" },
          },
          required: ["query"],
        },
      });
    }
    if (allowedTools.has("memory_get")) {
      tools.push({
        name: "memory_get",
        description: "Read a snippet from MEMORY.md or memory/*.md.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            from: { type: "number" },
            lines: { type: "number" },
          },
          required: ["path"],
        },
      });
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    if (name === "memory_search") {
      const query = typeof args?.query === "string" ? args.query : "";
      const maxResults = typeof args?.maxResults === "number" ? args.maxResults : undefined;
      const minScore = typeof args?.minScore === "number" ? args.minScore : undefined;
      const results = await memory.search(query, maxResults, minScore);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results }),
          },
        ],
      };
    }
    if (name === "memory_get") {
      const relPath = typeof args?.path === "string" ? args.path : "";
      const from = typeof args?.from === "number" ? args.from : undefined;
      const lines = typeof args?.lines === "number" ? args.lines : undefined;
      const result = await memory.readFile({ relPath, from, lines });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "unknown tool" }),
        },
      ],
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

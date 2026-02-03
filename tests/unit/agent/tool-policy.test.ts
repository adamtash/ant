import { describe, it, expect } from "vitest";
import { filterToolsByPolicy } from "../../../src/agent/tool-policy.js";

function makeTool(name: string, category: string) {
  return {
    meta: {
      name,
      description: `${name} tool`,
      category,
      version: "1.0.0",
    },
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => ({ ok: true }),
  } as any;
}

describe("tool-policy", () => {
  const tools = [
    makeTool("read", "file"),
    makeTool("write", "file"),
    makeTool("exec", "system"),
  ];

  it("returns all tools when no policy", () => {
    const filtered = filterToolsByPolicy(tools, undefined, {
      channel: "cli",
      sessionKey: "s",
      chatId: "c",
      model: "test",
      isSubagent: false,
    });
    expect(filtered.map((t: any) => t.meta.name).sort()).toEqual(["exec", "read", "write"]);
  });

  it("filters by allowedTools and deniedTools", () => {
    const filtered = filterToolsByPolicy(
      tools,
      {
        allowedTools: ["read", "write"],
        deniedTools: ["write"],
        allowedGroups: [],
        deniedGroups: [],
        allowedChannels: [],
        deniedChannels: [],
        allowedModels: [],
        deniedModels: [],
        allowedAudiences: [],
        deniedAudiences: [],
      },
      { channel: "cli", sessionKey: "s", chatId: "c", model: "test", isSubagent: false }
    );
    expect(filtered.map((t: any) => t.meta.name)).toEqual(["read"]);
  });

  it("filters by allowedGroups and deniedGroups", () => {
    const filtered = filterToolsByPolicy(
      tools,
      {
        allowedGroups: ["file"],
        deniedGroups: ["system"],
        allowedTools: [],
        deniedTools: [],
        allowedChannels: [],
        deniedChannels: [],
        allowedModels: [],
        deniedModels: [],
        allowedAudiences: [],
        deniedAudiences: [],
      },
      { channel: "cli", sessionKey: "s", chatId: "c", model: "test", isSubagent: false }
    );
    expect(filtered.map((t: any) => t.meta.name).sort()).toEqual(["read", "write"]);
  });

  it("filters entire toolset by channel", () => {
    const filtered = filterToolsByPolicy(
      tools,
      {
        allowedChannels: ["whatsapp"],
        deniedChannels: [],
        allowedGroups: [],
        deniedGroups: [],
        allowedTools: [],
        deniedTools: [],
        allowedModels: [],
        deniedModels: [],
        allowedAudiences: [],
        deniedAudiences: [],
      },
      { channel: "cli", sessionKey: "s", chatId: "c", model: "test", isSubagent: false }
    );
    expect(filtered).toEqual([]);
  });

  it("filters by model allow/deny", () => {
    const allowOnly = filterToolsByPolicy(
      tools,
      {
        allowedModels: ["gpt-foo"],
        deniedModels: [],
        allowedGroups: [],
        deniedGroups: [],
        allowedTools: [],
        deniedTools: [],
        allowedChannels: [],
        deniedChannels: [],
        allowedAudiences: [],
        deniedAudiences: [],
      },
      { channel: "cli", sessionKey: "s", chatId: "c", model: "gpt-foo", isSubagent: false }
    );
    expect(allowOnly.length).toBe(3);

    const denied = filterToolsByPolicy(
      tools,
      {
        allowedModels: [],
        deniedModels: ["gpt-foo"],
        allowedGroups: [],
        deniedGroups: [],
        allowedTools: [],
        deniedTools: [],
        allowedChannels: [],
        deniedChannels: [],
        allowedAudiences: [],
        deniedAudiences: [],
      },
      { channel: "cli", sessionKey: "s", chatId: "c", model: "gpt-foo", isSubagent: false }
    );
    expect(denied).toEqual([]);
  });
});


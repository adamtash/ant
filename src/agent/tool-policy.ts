import type { Tool, ToolPolicy, ToolPolicyContext } from "./types.js";

export function filterToolsByPolicy(
  tools: Tool[],
  policy: ToolPolicy | undefined,
  context: ToolPolicyContext
): Tool[] {
  if (!policy) return tools;

  const allowedGroups = new Set(policy.allowedGroups ?? []);
  const deniedGroups = new Set(policy.deniedGroups ?? []);
  const allowedTools = new Set(policy.allowedTools ?? []);
  const deniedTools = new Set(policy.deniedTools ?? []);
  const allowedChannels = new Set(policy.allowedChannels ?? []);
  const deniedChannels = new Set(policy.deniedChannels ?? []);
  const allowedModels = new Set((policy.allowedModels ?? []).map((model) => model.toLowerCase()));
  const deniedModels = new Set((policy.deniedModels ?? []).map((model) => model.toLowerCase()));
  const allowedAudiences = new Set(policy.allowedAudiences ?? []);
  const deniedAudiences = new Set(policy.deniedAudiences ?? []);

  if (allowedChannels.size > 0 && !allowedChannels.has(context.channel)) {
    return [];
  }
  if (deniedChannels.has(context.channel)) {
    return [];
  }

  if (context.model) {
    const model = context.model.toLowerCase();
    if (allowedModels.size > 0 && !allowedModels.has(model)) {
      return [];
    }
    if (deniedModels.has(model)) {
      return [];
    }
  }

  const audience = context.chatId ?? context.sessionKey;
  if (allowedAudiences.size > 0 && !allowedAudiences.has(audience)) {
    return [];
  }
  if (deniedAudiences.has(audience)) {
    return [];
  }

  return tools.filter((tool) => {
    if (deniedTools.has(tool.meta.name)) return false;
    if (deniedGroups.has(tool.meta.category)) return false;
    if (allowedTools.size > 0 && !allowedTools.has(tool.meta.name)) return false;
    if (allowedGroups.size > 0 && !allowedGroups.has(tool.meta.category)) return false;
    return true;
  });
}

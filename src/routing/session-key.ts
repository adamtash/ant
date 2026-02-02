import { parseAgentSessionKey } from "../sessions/session-key-utils.js";

export const DEFAULT_AGENT_ID = "main";
export const DEFAULT_MAIN_KEY = "main";

const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function normalizeToken(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeMainKey(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.toLowerCase() : DEFAULT_MAIN_KEY;
}

export function normalizeAgentId(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return DEFAULT_AGENT_ID;
  if (VALID_ID_RE.test(trimmed)) return trimmed.toLowerCase();
  return (
    trimmed
      .toLowerCase()
      .replace(INVALID_CHARS_RE, "-")
      .replace(LEADING_DASH_RE, "")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, 64) || DEFAULT_AGENT_ID
  );
}

export function toAgentStoreSessionKey(params: {
  agentId: string;
  requestKey: string | undefined | null;
  mainKey?: string | undefined;
}): string {
  const raw = (params.requestKey ?? "").trim();
  if (!raw || raw === DEFAULT_MAIN_KEY) {
    return buildAgentMainSessionKey({ agentId: params.agentId, mainKey: params.mainKey });
  }
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("agent:")) return lowered;
  if (lowered.startsWith("subagent:")) {
    return `agent:${normalizeAgentId(params.agentId)}:${lowered}`;
  }
  return `agent:${normalizeAgentId(params.agentId)}:${lowered}`;
}

export function resolveAgentIdFromSessionKey(sessionKey: string | undefined | null): string {
  const parsed = parseAgentSessionKey(sessionKey);
  return normalizeAgentId(parsed?.agentId ?? DEFAULT_AGENT_ID);
}

export function buildAgentMainSessionKey(params: { agentId: string; mainKey?: string | undefined }): string {
  const agentId = normalizeAgentId(params.agentId);
  const mainKey = normalizeMainKey(params.mainKey);
  return `agent:${agentId}:${mainKey}`;
}

export function buildAgentScopedSessionKey(params: { agentId: string; scope: string }): string {
  const agentId = normalizeAgentId(params.agentId);
  const scope = normalizeToken(params.scope) || DEFAULT_MAIN_KEY;
  return `agent:${agentId}:${scope}`;
}

export function buildAgentTaskSessionKey(params: { agentId: string; taskId: string }): string {
  const agentId = normalizeAgentId(params.agentId);
  const taskId = normalizeToken(params.taskId) || "task";
  return `agent:${agentId}:task:${taskId}`;
}

export function buildAgentSubagentSessionKey(params: {
  agentId: string;
  subagentId: string;
  parentTaskId?: string;
}): string {
  const agentId = normalizeAgentId(params.agentId);
  const subagentId = normalizeToken(params.subagentId) || "subagent";
  const parent = normalizeToken(params.parentTaskId);
  if (parent) {
    return `agent:${agentId}:subagent:${parent}:${subagentId}`;
  }
  return `agent:${agentId}:subagent:${subagentId}`;
}

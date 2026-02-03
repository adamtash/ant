export type AgentEventStream = "lifecycle" | "tool" | "assistant" | "error" | (string & {});

export type AgentEventPayload = {
  runId: string;
  seq: number;
  stream: AgentEventStream;
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  agentType?: "agent" | "subagent";
  isHeartbeat?: boolean;
};

const seqByRun = new Map<string, number>();
const listeners = new Set<(evt: AgentEventPayload) => void>();
const runContextById = new Map<string, AgentRunContext>();

export function registerAgentRunContext(runId: string, context: AgentRunContext): void {
  if (!runId) return;
  const existing = runContextById.get(runId);
  if (!existing) {
    runContextById.set(runId, { ...context });
    return;
  }
  if (context.sessionKey && existing.sessionKey !== context.sessionKey) {
    existing.sessionKey = context.sessionKey;
  }
  if (context.agentType && existing.agentType !== context.agentType) {
    existing.agentType = context.agentType;
  }
  if (context.isHeartbeat !== undefined && existing.isHeartbeat !== context.isHeartbeat) {
    existing.isHeartbeat = context.isHeartbeat;
  }
}

export function getAgentRunContext(runId: string): AgentRunContext | undefined {
  return runContextById.get(runId);
}

export function clearAgentRunContext(runId: string): void {
  runContextById.delete(runId);
}

export function resetAgentRunContextForTest(): void {
  runContextById.clear();
}

export function resetAgentEventsForTest(): void {
  seqByRun.clear();
  listeners.clear();
  runContextById.clear();
}

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">): void {
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const context = runContextById.get(event.runId);
  const sessionKey =
    typeof event.sessionKey === "string" && event.sessionKey.trim()
      ? event.sessionKey
      : context?.sessionKey;
  const enriched: AgentEventPayload = {
    ...event,
    sessionKey,
    seq: nextSeq,
    ts: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(enriched);
    } catch {
      // Ignore listener errors
    }
  }
}

export function onAgentEvent(listener: (evt: AgentEventPayload) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

import { describe, it, expect, beforeEach } from "vitest";
import {
  emitAgentEvent,
  onAgentEvent,
  registerAgentRunContext,
  clearAgentRunContext,
  resetAgentEventsForTest,
} from "../../../src/monitor/agent-events.js";

describe("agent-events", () => {
  beforeEach(() => {
    resetAgentEventsForTest();
  });

  it("increments seq per runId and enriches sessionKey from run context", () => {
    registerAgentRunContext("run-1", { sessionKey: "session-1", agentType: "agent" });

    const events: any[] = [];
    const unsubscribe = onAgentEvent((evt) => events.push(evt));

    emitAgentEvent({ runId: "run-1", stream: "lifecycle", data: { stage: "start" } });
    emitAgentEvent({ runId: "run-1", stream: "tool", data: { tool: "read" } });

    unsubscribe();

    expect(events.length).toBe(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
    expect(events[0].sessionKey).toBe("session-1");
    expect(events[1].sessionKey).toBe("session-1");
  });

  it("prefers explicit sessionKey over run context", () => {
    registerAgentRunContext("run-2", { sessionKey: "session-context", agentType: "agent" });

    const events: any[] = [];
    const unsubscribe = onAgentEvent((evt) => events.push(evt));

    emitAgentEvent({ runId: "run-2", stream: "assistant", data: { msg: "hi" }, sessionKey: "session-explicit" });

    unsubscribe();

    expect(events.length).toBe(1);
    expect(events[0].sessionKey).toBe("session-explicit");
  });

  it("clears run context", () => {
    registerAgentRunContext("run-3", { sessionKey: "session-3" });
    clearAgentRunContext("run-3");

    const events: any[] = [];
    const unsubscribe = onAgentEvent((evt) => events.push(evt));
    emitAgentEvent({ runId: "run-3", stream: "lifecycle", data: { stage: "start" } });
    unsubscribe();

    expect(events.length).toBe(1);
    expect(events[0].sessionKey).toBeUndefined();
  });
});


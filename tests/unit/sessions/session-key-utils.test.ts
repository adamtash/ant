import { describe, it, expect } from "vitest";
import {
  parseAgentSessionKey,
  isSubagentSessionKey,
  isAcpSessionKey,
  resolveThreadParentSessionKey,
} from "../../../src/sessions/session-key-utils.js";

describe("session-key-utils", () => {
  describe("parseAgentSessionKey", () => {
    it("returns null for empty/invalid values", () => {
      expect(parseAgentSessionKey(undefined)).toBeNull();
      expect(parseAgentSessionKey("")).toBeNull();
      expect(parseAgentSessionKey("cli:ask")).toBeNull();
      expect(parseAgentSessionKey("agent:only-two")).toBeNull();
    });

    it("parses valid agent session keys", () => {
      expect(parseAgentSessionKey("agent:main:system")).toEqual({ agentId: "main", rest: "system" });
      expect(parseAgentSessionKey("agent:alpha:subagent:123")).toEqual({ agentId: "alpha", rest: "subagent:123" });
    });
  });

  describe("isSubagentSessionKey", () => {
    it("detects subagent keys", () => {
      expect(isSubagentSessionKey("subagent:123")).toBe(true);
      expect(isSubagentSessionKey("agent:main:subagent:123")).toBe(true);
      expect(isSubagentSessionKey("agent:main:system")).toBe(false);
      expect(isSubagentSessionKey("")).toBe(false);
    });
  });

  describe("isAcpSessionKey", () => {
    it("detects ACP keys", () => {
      expect(isAcpSessionKey("acp:123")).toBe(true);
      expect(isAcpSessionKey("agent:main:acp:thread:xyz")).toBe(true);
      expect(isAcpSessionKey("agent:main:system")).toBe(false);
      expect(isAcpSessionKey("")).toBe(false);
    });
  });

  describe("resolveThreadParentSessionKey", () => {
    it("returns null when no markers present", () => {
      expect(resolveThreadParentSessionKey("agent:main:system")).toBeNull();
      expect(resolveThreadParentSessionKey("")).toBeNull();
    });

    it("truncates to parent key for thread/topic markers", () => {
      expect(resolveThreadParentSessionKey("acp:thread:abc")).toBe("acp");
      expect(resolveThreadParentSessionKey("agent:main:acp:thread:abc")).toBe("agent:main:acp");
      expect(resolveThreadParentSessionKey("agent:main:topic:weekly")).toBe("agent:main");
    });
  });
});


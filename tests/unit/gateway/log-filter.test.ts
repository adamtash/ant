import { describe, expect, it } from "vitest";

import { shouldIncludeGatewayLogLine } from "../../../src/gateway/server.js";

describe("shouldIncludeGatewayLogLine", () => {
  it("filters non-error WhatsApp JSON logs", () => {
    const line = JSON.stringify({
      level: 30,
      module: "whatsapp-client",
      msg: "WhatsApp heartbeat",
    });
    expect(shouldIncludeGatewayLogLine(line)).toBe(false);
  });

  it("keeps WhatsApp JSON errors", () => {
    const line = JSON.stringify({
      level: 50,
      module: "whatsapp-client",
      msg: "failed to decrypt message",
    });
    expect(shouldIncludeGatewayLogLine(line)).toBe(true);
  });

  it("keeps non-WhatsApp logs", () => {
    const line = JSON.stringify({
      level: 30,
      module: "provider",
      msg: "provider request complete",
    });
    expect(shouldIncludeGatewayLogLine(line)).toBe(true);
  });

  it("keeps plain text only when it looks like a WhatsApp error", () => {
    expect(shouldIncludeGatewayLogLine("WhatsApp sync tick")).toBe(false);
    expect(shouldIncludeGatewayLogLine("WhatsApp error: decrypt failed")).toBe(true);
  });
});

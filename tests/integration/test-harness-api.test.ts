/**
 * Test Harness API Integration Tests
 *
 * Verifies that the runtime exposes test-only endpoints used by programmatic harnesses
 * (e.g., simulated WhatsApp inbound/outbound).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  spawnTestInstance,
  waitForGateway,
  cleanupTest,
  httpGet,
  httpPost,
  type TestInstance,
} from "./setup.js";

describe("Test Harness API", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({ enableWhatsApp: true, enableTelegram: true, enableMemory: false });
    await waitForGateway(instance, 15000);
  }, 300000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  it("should expose WhatsApp outbound endpoint in test mode", async () => {
    const res = await httpGet(instance, "/api/test/whatsapp/outbound");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.outbound)).toBe(true);
  });

  it("should reject inbound WhatsApp messages that fail adapter filters", async () => {
    await httpPost(instance, "/api/test/whatsapp/outbound/clear", {});

    const res = await httpPost(instance, "/api/test/whatsapp/inbound", {
      chatId: "someone-else@s.whatsapp.net",
      text: "hello from outside self-chat",
      senderId: "tester@s.whatsapp.net",
      pushName: "Tester",
      fromMe: false,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.accepted).toBe(false);

    const outRes = await httpGet(instance, "/api/test/whatsapp/outbound");
    expect(outRes.status).toBe(200);
    const out = await outRes.json();
    expect(out.ok).toBe(true);
    expect(out.outbound.length).toBe(0);
  });

  it("should expose Telegram outbound endpoint in test mode", async () => {
    const res = await httpGet(instance, "/api/test/telegram/outbound");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.outbound)).toBe(true);
  });
});

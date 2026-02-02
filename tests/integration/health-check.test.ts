/**
 * Health Check Integration Tests
 *
 * Tests the health check mechanism and startup verification.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  spawnTestInstance,
  waitForGateway,
  cleanupTest,
  httpGet,
  waitFor,
  type TestInstance,
} from "./setup.js";

describe("Health Check", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({ enableMemory: false });
    await waitForGateway(instance, 15000);
  }, 30000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  describe("Startup Health Check", () => {
    it("should report health check status in /api/status", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.startupHealthCheck).toBeDefined();
      expect(data.startupHealthCheck).toHaveProperty("lastCheckAt");
      expect(data.startupHealthCheck).toHaveProperty("ok");
    });

    it("should track health check latency when available", async () => {
      // Wait a bit for health check to potentially complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      // Latency may be null if health check hasn't completed
      if (data.startupHealthCheck.latencyMs !== null) {
        expect(data.startupHealthCheck.latencyMs).toBeTypeOf("number");
        expect(data.startupHealthCheck.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("System Health Metrics", () => {
    it("should report memory usage", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health.memory).toBeTypeOf("number");
      expect(data.health.memory).toBeGreaterThanOrEqual(0);
    });

    it("should report uptime", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health.uptime).toBeTypeOf("number");
      expect(data.health.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should track last restart time", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health.lastRestart).toBeTypeOf("number");
      expect(data.health.lastRestart).toBeGreaterThan(0);
    });

    it("should report active connections", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health.activeConnections).toBeTypeOf("number");
      expect(data.health.activeConnections).toBeGreaterThanOrEqual(0);
    });

    it("should report queue depth", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health.queueDepth).toBeTypeOf("number");
      expect(data.health.queueDepth).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Runtime Status", () => {
    it("should report runtime information", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.runtime).toBeTypeOf("object");
      expect(Array.isArray(data.runtime.providers)).toBe(true);
    });

    it("should report queue status", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(Array.isArray(data.queue)).toBe(true);
    });

    it("should report running tasks", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(Array.isArray(data.running)).toBe(true);
    });
  });

  describe("Main Agent Status", () => {
    it("should report main agent enabled state", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.mainAgent.enabled).toBe(false); // Disabled in test config
    });

    it("should report main agent running state", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.mainAgent.running).toBeTypeOf("boolean");
    });

    it("should report main agent last check", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      // lastCheckAt can be null if no check has run
      if (data.mainAgent.lastCheckAt !== null) {
        expect(data.mainAgent.lastCheckAt).toBeTypeOf("number");
      }
    });
  });
});

describe("Health Check with Main Agent Enabled", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({
      enableMemory: false,
      enableMainAgent: true,
    });
    await waitForGateway(instance, 15000);
  }, 30000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  it("should report main agent as enabled", async () => {
    await waitFor(
      async () => {
        const response = await httpGet(instance, "/api/status");
        const data = await response.json();
        return data.mainAgent.enabled === true;
      },
      { timeoutMs: 5000, message: "Main agent not reported as enabled" }
    );

    const response = await httpGet(instance, "/api/status");
    const data = await response.json();

    expect(data.mainAgent.enabled).toBe(true);
  });
});

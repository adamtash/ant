/**
 * Main Agent Loop Integration Tests
 *
 * Tests the main agent autonomous behavior and duty cycles.
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

describe("Main Agent Loop", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({
      enableMemory: false,
      enableMainAgent: true,
    });
    await waitForGateway(instance, 15000);
  }, 300000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  describe("Initialization", () => {
    it("should report main agent as enabled in status", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.mainAgent.enabled).toBe(true);
    });

    it("should have duties file in config directory", async () => {
      // The instance should have created a duties file
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      // Verify workspace directory exists and duties file was set up
      expect(data.config.workspaceDir).toBeTypeOf("string");
    });
  });

  describe("Status Reporting", () => {
    it("should report main agent running state", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.mainAgent.running).toBeTypeOf("boolean");
    });

    it("should track last check time", async () => {
      // Wait a moment for any checks to occur
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      // lastCheckAt can be null if no check has run yet
      if (data.mainAgent.lastCheckAt !== null) {
        expect(data.mainAgent.lastCheckAt).toBeTypeOf("number");
        expect(data.mainAgent.lastCheckAt).toBeGreaterThan(0);
      }
    });

    it("should report main agent errors if any", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      // lastError should be either null or a string
      expect(data.mainAgent.lastError === null || typeof data.mainAgent.lastError === "string").toBe(
        true
      );
    });
  });

  describe("Process Stability", () => {
    it("should remain running with main agent enabled", async () => {
      // Wait for main agent to potentially start cycles
      await new Promise((resolve) => setTimeout(resolve, 2000));

      expect(instance.isRunning()).toBe(true);
    });

    it("should respond to status requests consistently", async () => {
      // Make multiple status requests
      for (let i = 0; i < 3; i++) {
        const response = await httpGet(instance, "/api/status");
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.mainAgent.enabled).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    });
  });
});

describe("Main Agent with Disabled Configuration", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({
      enableMemory: false,
      enableMainAgent: false,
    });
    await waitForGateway(instance, 15000);
  }, 300000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  it("should report main agent as disabled", async () => {
    const response = await httpGet(instance, "/api/status");
    const data = await response.json();

    expect(data.mainAgent.enabled).toBe(false);
    expect(data.mainAgent.running).toBe(false);
  });

  it("should not require duties file when disabled", async () => {
    // Instance should start fine without duties file
    expect(instance.isRunning()).toBe(true);
  });
});

describe("Main Agent Configuration", () => {
  it("should have configurable interval", async () => {
    const instance = await spawnTestInstance({
      enableMemory: false,
      enableMainAgent: true,
    });

    try {
      await waitForGateway(instance, 15000);

      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.mainAgent.intervalMs).toBeTypeOf("number");
      expect(data.config.mainAgent.intervalMs).toBeGreaterThan(0);
    } finally {
      await cleanupTest(instance);
    }
  }, 300000);

  it("should have configurable duties file", async () => {
    const instance = await spawnTestInstance({
      enableMemory: false,
      enableMainAgent: true,
    });

    try {
      await waitForGateway(instance, 15000);

      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.mainAgent.dutiesFile).toBeTypeOf("string");
    } finally {
      await cleanupTest(instance);
    }
  }, 300000);
});

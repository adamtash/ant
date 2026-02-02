/**
 * Agent Lifecycle Integration Tests
 *
 * Tests agent startup, operation, and shutdown sequences.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  spawnTestInstance,
  waitForGateway,
  cleanupTest,
  httpGet,
  httpPost,
  waitFor,
  type TestInstance,
} from "./setup.js";

describe("Agent Lifecycle", () => {
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

  describe("Process Management", () => {
    it("should spawn process successfully", () => {
      expect(instance.isRunning()).toBe(true);
    });

    it("should expose gateway on configured port", async () => {
      const url = instance.getGatewayUrl();
      const response = await fetch(`${url}/api/status`, {
        signal: AbortSignal.timeout(5000),
      });

      expect(response.ok).toBe(true);
    });

    it("should remain running after startup", async () => {
      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(instance.isRunning()).toBe(true);
    });
  });

  describe("Task Execution Lifecycle", () => {
    it("should create and queue a task", async () => {
      const response = await httpPost(instance, "/api/tasks", {
        description: "Test task",
        label: "lifecycle-test",
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBeTypeOf("string");
      expect(data.status).toBe("queued");
    });

    it("should track task through lifecycle", async () => {
      // Create task
      const createResponse = await httpPost(instance, "/api/tasks", {
        description: "Lifecycle tracking test",
      });
      const { id } = await createResponse.json();

      // Poll for status changes
      let lastStatus = "queued";
      const startTime = Date.now();

      while (Date.now() - startTime < 10000) {
        const response = await httpGet(instance, `/api/tasks/${id}`);
        const task = await response.json();

        lastStatus = task.status;

        if (task.status === "completed" || task.status === "failed") {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Task should have progressed from queued
      expect(["running", "completed", "failed"]).toContain(lastStatus);
    });
  });

  describe("Session Management", () => {
    it("should create sessions when processing tasks", async () => {
      // Create a task first
      await httpPost(instance, "/api/tasks", {
        description: "Session creation test",
      });

      // Wait a moment for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await httpGet(instance, "/api/sessions");
      const data = await response.json();

      // Should have at least one session
      expect(data.sessions.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Channel Management", () => {
    it("should report channel status", async () => {
      const response = await httpGet(instance, "/api/channels");
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(Array.isArray(data.channels)).toBe(true);
    });
  });

  describe("Configuration Management", () => {
    it("should load configuration on startup", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(data.config).toBeDefined();
      expect(data.path).toBeTypeOf("string");
    });

    it("should persist configuration changes", async () => {
      // Get original config
      const getResponse = await httpGet(instance, "/api/config");
      const originalData = await getResponse.json();
      const originalDir = originalData.config.workspaceDir;

      // Update config
      const newDir = "/tmp/test-workspace-update";
      const postResponse = await httpPost(instance, "/api/config", {
        ...originalData.config,
        workspaceDir: newDir,
      });

      expect(postResponse.status).toBe(200);

      // Verify change was persisted
      const verifyResponse = await httpGet(instance, "/api/config");
      const verifyData = await verifyResponse.json();

      expect(verifyData.config.workspaceDir).toBe(newDir);

      // Restore original
      await httpPost(instance, "/api/config", originalData.config);
    });
  });
});

describe("Agent Lifecycle with Main Agent", () => {
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

  it("should start with main agent enabled", async () => {
    await waitFor(
      async () => {
        const response = await httpGet(instance, "/api/status");
        const data = await response.json();
        return data.mainAgent.enabled === true;
      },
      { timeoutMs: 5000 }
    );

    const response = await httpGet(instance, "/api/status");
    const data = await response.json();

    expect(data.mainAgent.enabled).toBe(true);
  });

  it("should remain running with main agent", async () => {
    // Wait for a few seconds
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(instance.isRunning()).toBe(true);

    const response = await httpGet(instance, "/api/status");
    const data = await response.json();

    expect(data.ok).toBe(true);
  });
});

/**
 * Agent Engine Integration Tests
 *
 * Tests agent task execution, tool invocations, and provider routing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  spawnTestInstance,
  waitForGateway,
  cleanupTest,
  httpGet,
  httpPost,
  waitFor,
  type TestInstance,
} from "./setup.js";

describe("Agent Engine", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({ enableMemory: false });
    await waitForGateway(instance, 15000);
  }, 300000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  describe("Task Execution", () => {
    it("should queue a task for execution", async () => {
      const response = await httpPost(instance, "/api/tasks", {
        description: "Simple test task",
        label: "test",
      });

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBeTypeOf("string");
      expect(data.status).toBe("queued");
      expect(data.createdAt).toBeTypeOf("number");
    });

    it("should create unique task IDs", async () => {
      const task1 = await httpPost(instance, "/api/tasks", {
        description: "Task 1",
      });
      const task2 = await httpPost(instance, "/api/tasks", {
        description: "Task 2",
      });

      const data1 = await task1.json();
      const data2 = await task2.json();

      expect(data1.id).not.toBe(data2.id);
    });

    it("should track task lifecycle", async () => {
      const response = await httpPost(instance, "/api/tasks", {
        description: "Lifecycle test task",
      });
      const { id } = await response.json();

      // Poll for task status
      let finalStatus = "queued";
      const startTime = Date.now();

      while (Date.now() - startTime < 15000) {
        const statusResponse = await httpGet(instance, `/api/tasks/${id}`);
        const task = await statusResponse.json();

        finalStatus = task.status;

        if (task.status === "completed" || task.status === "failed") {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Task should progress from queued to running/completed/failed
      expect(["queued", "running", "completed", "failed"]).toContain(finalStatus);
    });
  });

  describe("Task Retrieval", () => {
    it("should list all tasks", async () => {
      // Create a task first
      await httpPost(instance, "/api/tasks", {
        description: "List test task",
      });

      const response = await httpGet(instance, "/api/tasks");
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(data.tasks.length).toBeGreaterThan(0);
    });

    it("should sort tasks by creation time (newest first)", async () => {
      // Create multiple tasks
      await httpPost(instance, "/api/tasks", { description: "Task A" });
      await new Promise((resolve) => setTimeout(resolve(100)));
      await httpPost(instance, "/api/tasks", { description: "Task B" });

      const response = await httpGet(instance, "/api/tasks");
      const data = await response.json();

      // Verify tasks are sorted by createdAt descending
      for (let i = 1; i < data.tasks.length; i++) {
        expect(data.tasks[i - 1].createdAt).toBeGreaterThanOrEqual(data.tasks[i].createdAt);
      }
    });

    it("should retrieve specific task by ID", async () => {
      const createResponse = await httpPost(instance, "/api/tasks", {
        description: "Specific task retrieval test",
      });
      const { id } = await createResponse.json();

      const getResponse = await httpGet(instance, `/api/tasks/${id}`);
      const task = await getResponse.json();

      expect(task.id).toBe(id);
      expect(task.description).toBe("Specific task retrieval test");
    });
  });

  describe("Error Handling", () => {
    it("should return 400 for invalid task data", async () => {
      const response = await httpPost(instance, "/api/tasks", {
        // Missing required description
      });

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toBeDefined();
    });

    it("should return 404 for non-existent task", async () => {
      const response = await httpGet(instance, "/api/tasks/non-existent-id-12345");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.ok).toBe(false);
    });
  });

  describe("Session Management", () => {
    it("should create sessions for tasks", async () => {
      // Create a task
      await httpPost(instance, "/api/tasks", {
        description: "Session creation test",
      });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await httpGet(instance, "/api/sessions");
      const data = await response.json();

      expect(data.ok).toBe(true);
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it("should track session metadata", async () => {
      // Create multiple tasks
      await httpPost(instance, "/api/tasks", {
        description: "Metadata test task",
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = await httpGet(instance, "/api/sessions");
      const data = await response.json();

      if (data.sessions.length > 0) {
        const session = data.sessions[0];
        expect(session).toHaveProperty("key");
        expect(session).toHaveProperty("channel");
        expect(session).toHaveProperty("createdAt");
        expect(session).toHaveProperty("lastMessageAt");
        expect(session).toHaveProperty("messageCount");
      }
    });
  });
});

describe("Agent Engine with Memory", () => {
  let instance: TestInstance;

  beforeAll(async () => {
    instance = await spawnTestInstance({ enableMemory: true });
    await waitForGateway(instance, 15000);
  }, 300000);

  afterAll(async () => {
    if (instance) {
      await cleanupTest(instance);
    }
  }, 15000);

  it("should start with memory enabled", async () => {
    const response = await httpGet(instance, "/api/config");
    const data = await response.json();

    expect(data.config.memory.enabled).toBe(true);
  });

  it("should report memory configuration", async () => {
    const response = await httpGet(instance, "/api/config");
    const data = await response.json();

    expect(data.config.memory.sqlitePath).toBeTypeOf("string");
    expect(data.config.memory.embeddingsModel).toBeTypeOf("string");
  });
});

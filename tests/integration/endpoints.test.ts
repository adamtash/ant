/**
 * HTTP Endpoint Integration Tests
 *
 * Tests all gateway HTTP endpoints to verify they respond correctly.
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

describe("Gateway HTTP Endpoints", () => {
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

  describe("GET /api/status", () => {
    it("should return 200 with valid status", async () => {
      const response = await httpGet(instance, "/api/status");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.time).toBeTypeOf("number");
      expect(data.runtime).toBeTypeOf("object");
      expect(data.health).toBeTypeOf("object");
    });

    it("should include health metrics", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.health).toMatchObject({
        memory: expect.any(Number),
        uptime: expect.any(Number),
        activeConnections: expect.any(Number),
      });
    });

    it("should include main agent status", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.mainAgent).toBeDefined();
      expect(data.mainAgent.enabled).toBeTypeOf("boolean");
      expect(data.mainAgent.running).toBeTypeOf("boolean");
    });

    it("should include startup health check info", async () => {
      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      expect(data.startupHealthCheck).toBeDefined();
    });
  });

  describe("GET /api/sessions", () => {
    it("should return 200 with sessions list", async () => {
      const response = await httpGet(instance, "/api/sessions");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it("should return empty array initially", async () => {
      const response = await httpGet(instance, "/api/sessions");
      const data = await response.json();

      expect(data.sessions).toEqual([]);
    });
  });

  describe("GET /api/sessions/:key", () => {
    it("should return 404 for non-existent session", async () => {
      const response = await httpGet(instance, "/api/sessions/nonexistent");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("GET /api/config", () => {
    it("should return 200 with configuration", async () => {
      const response = await httpGet(instance, "/api/config");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.config).toBeTypeOf("object");
      expect(data.path).toBeTypeOf("string");
    });

    it("should include workspace directory", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.workspaceDir).toBeTypeOf("string");
    });
  });

  describe("POST /api/config", () => {
    it("should update configuration", async () => {
      const update = { workspaceDir: "/tmp/test-update" };
      const response = await httpPost(instance, "/api/config", update);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
    });
  });

  describe("GET /api/channels", () => {
    it("should return 200 with channel list", async () => {
      const response = await httpGet(instance, "/api/channels");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.channels)).toBe(true);
    });
  });

  describe("GET /api/tasks", () => {
    it("should return 200 with tasks list", async () => {
      const response = await httpGet(instance, "/api/tasks");

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(Array.isArray(data.tasks)).toBe(true);
    });
  });

  describe("POST /api/tasks", () => {
    it("should create a new task", async () => {
      const task = {
        description: "Test task for integration testing",
        label: "test-task",
      };

      const response = await httpPost(instance, "/api/tasks", task);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(data.id).toBeTypeOf("string");
      expect(data.status).toBe("queued");
    });

    it("should return 400 for missing description", async () => {
      const response = await httpPost(instance, "/api/tasks", {});

      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(data.error).toContain("required");
    });
  });

  describe("GET /api/tasks/:id", () => {
    it("should return 404 for non-existent task", async () => {
      const response = await httpGet(instance, "/api/tasks/nonexistent-task-id");

      expect(response.status).toBe(404);

      const data = await response.json();
      expect(data.ok).toBe(false);
    });

    it("should return task details for existing task", async () => {
      // First create a task
      const createResponse = await httpPost(instance, "/api/tasks", {
        description: "Test task",
      });
      const { id } = await createResponse.json();

      // Then fetch it
      const response = await httpGet(instance, `/api/tasks/${id}`);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.id).toBe(id);
      expect(data.description).toBe("Test task");
    });
  });

  describe("GET /api/logs/stream", () => {
    it("should return SSE headers", async () => {
      const controller = new AbortController();

      try {
        const response = await httpGet(instance, "/api/logs/stream");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
      } finally {
        controller.abort();
      }
    });
  });

  describe("GET /api/events/stream", () => {
    it("should return SSE headers", async () => {
      const response = await httpGet(instance, "/api/events/stream");

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
    });
  });
});

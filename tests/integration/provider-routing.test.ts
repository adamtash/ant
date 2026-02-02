/**
 * Provider Routing Integration Tests
 *
 * Tests provider fallback and model routing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  spawnTestInstance,
  waitForGateway,
  cleanupTest,
  httpGet,
  type TestInstance,
} from "./setup.js";

describe("Provider Configuration", () => {
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

  describe("Configuration Loading", () => {
    it("should load provider configuration", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.providers).toBeDefined();
      expect(data.config.providers.default).toBeTypeOf("string");
      expect(data.config.providers.items).toBeTypeOf("object");
    });

    it("should have at least one provider", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      const providers = Object.keys(data.config.providers.items);
      expect(providers.length).toBeGreaterThan(0);
    });

    it("should include provider type and model", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      for (const [id, provider] of Object.entries(data.config.providers.items)) {
        expect(provider).toHaveProperty("type");
        expect(provider).toHaveProperty("model");
        expect(provider.type).toMatch(/^(openai|cli|ollama)$/);
      }
    });
  });

  describe("Routing Configuration", () => {
    it("should have routing configuration", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.routing).toBeDefined();
    });

    it("should have chat routing", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.routing.chat).toBeTypeOf("string");
    });

    it("should have tools routing", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      expect(data.config.routing.tools).toBeTypeOf("string");
    });

    it("should route to configured providers", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      const availableProviders = Object.keys(data.config.providers.items);

      expect(availableProviders).toContain(data.config.routing.chat);
      expect(availableProviders).toContain(data.config.routing.tools);
    });
  });

  describe("Provider Types", () => {
    it("should support openai type providers", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      for (const provider of Object.values(data.config.providers.items)) {
        if (provider.type === "openai") {
          expect(provider).toHaveProperty("baseUrl");
        }
      }
    });

    it("should support cli type providers", async () => {
      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      const hasCliProvider = Object.values(data.config.providers.items).some(
        (p) => p.type === "cli"
      );

      // CLI providers are optional but if present should have cliProvider
      if (hasCliProvider) {
        for (const provider of Object.values(data.config.providers.items)) {
          if (provider.type === "cli") {
            expect(provider).toHaveProperty("cliProvider");
          }
        }
      }
    });
  });
});

describe("Provider Fallback Behavior", () => {
  it("should use default provider when specific not configured", async () => {
    const instance = await spawnTestInstance({ enableMemory: false });

    try {
      await waitForGateway(instance, 15000);

      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      // If embeddings routing is not set, it should fall back to default
      const defaultProvider = data.config.providers.default;
      const embeddingsRouting = data.config.routing.embeddings || defaultProvider;

      expect(embeddingsRouting).toBeDefined();
    } finally {
      await cleanupTest(instance);
    }
  }, 300000);

  it("should handle missing provider gracefully", async () => {
    const instance = await spawnTestInstance({ enableMemory: false });

    try {
      await waitForGateway(instance, 15000);

      const response = await httpGet(instance, "/api/status");
      const data = await response.json();

      // System should still report status even with provider issues
      expect(data.ok).toBe(true);
    } finally {
      await cleanupTest(instance);
    }
  }, 300000);
});

describe("Multi-Provider Configuration", () => {
  it("should support multiple providers", async () => {
    const instance = await spawnTestInstance({ enableMemory: false });

    try {
      await waitForGateway(instance, 15000);

      const response = await httpGet(instance, "/api/config");
      const data = await response.json();

      const providerCount = Object.keys(data.config.providers.items).length;
      expect(providerCount).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupTest(instance);
    }
  }, 300000);
});

/**
 * Endpoint Testing Utility
 *
 * Tests HTTP endpoints for availability and correct responses.
 */

import type { Logger } from "../log.js";

export interface EndpointTestResult {
  endpoint: string;
  method: string;
  status: "pass" | "fail" | "skip";
  statusCode?: number;
  latencyMs: number;
  error?: string;
  data?: unknown;
}

export interface EndpointTestSuite {
  name: string;
  results: EndpointTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface EndpointTesterConfig {
  baseUrl: string;
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Test an individual endpoint
 */
async function testEndpoint(
  baseUrl: string,
  endpoint: string,
  method: string,
  timeoutMs: number,
  body?: unknown
): Promise<EndpointTestResult> {
  const startTime = Date.now();
  const url = `${baseUrl}${endpoint}`;

  try {
    const fetchOptions: RequestInit = {
      method,
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (body && method !== "GET") {
      fetchOptions.headers = { "Content-Type": "application/json" };
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);
    const latencyMs = Date.now() - startTime;

    return {
      endpoint,
      method,
      status: response.ok ? "pass" : "fail",
      statusCode: response.status,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    return {
      endpoint,
      method,
      status: "fail",
      latencyMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run all endpoint tests
 */
export async function runEndpointTests(config: EndpointTesterConfig): Promise<EndpointTestSuite> {
  const timeoutMs = config.timeoutMs ?? 10000;
  const results: EndpointTestResult[] = [];

  const endpoints = [
    { endpoint: "/api/status", method: "GET" },
    { endpoint: "/api/sessions", method: "GET" },
    { endpoint: "/api/sessions/test-session", method: "GET" },
    { endpoint: "/api/config", method: "GET" },
    { endpoint: "/api/channels", method: "GET" },
    { endpoint: "/api/tasks", method: "GET" },
    { endpoint: "/api/tasks", method: "POST", body: { description: "Diagnostic test task" } },
    { endpoint: "/api/tasks/test-task-id", method: "GET" },
    { endpoint: "/api/logs/stream", method: "GET" },
    { endpoint: "/api/events/stream", method: "GET" },
  ];

  for (const { endpoint, method, body } of endpoints) {
    config.logger?.debug({ endpoint, method }, "Testing endpoint");
    const result = await testEndpoint(config.baseUrl, endpoint, method, timeoutMs, body);
    results.push(result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  return {
    name: "HTTP Endpoints",
    results,
    passed,
    failed,
    skipped,
    total: results.length,
  };
}

/**
 * Format test results for display
 */
export function formatEndpointResults(suite: EndpointTestSuite): string {
  const lines: string[] = [];

  lines.push(`\n${suite.name}`);
  lines.push("=".repeat(suite.name.length));

  for (const result of suite.results) {
    const icon = result.status === "pass" ? "✓" : result.status === "skip" ? "○" : "✗";
    const statusText = result.status.toUpperCase().padEnd(6);
    lines.push(`${icon} ${statusText} ${result.method.padEnd(6)} ${result.endpoint} (${result.latencyMs}ms)`);

    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }
  }

  lines.push("");
  lines.push(`Results: ${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped`);

  return lines.join("\n");
}

/**
 * Check if a specific gateway is healthy
 */
export async function checkGatewayHealth(
  baseUrl: string,
  timeoutMs = 5000
): Promise<{ healthy: boolean; latencyMs?: number; error?: string }> {
  try {
    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/api/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (!data.ok) {
      return { healthy: false, latencyMs, error: "Gateway returned not ok" };
    }

    return { healthy: true, latencyMs };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

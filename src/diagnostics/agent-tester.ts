/**
 * Agent Functionality Testing Utility
 *
 * Tests agent startup, health, and basic functionality.
 */

import type { Logger } from "../log.js";

export interface AgentTestResult {
  test: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  error?: string;
  details?: unknown;
}

export interface AgentTestSuite {
  name: string;
  results: AgentTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface AgentTesterConfig {
  gatewayUrl: string;
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Run a single agent test
 */
async function runTest(
  name: string,
  testFn: () => Promise<unknown>,
  timeoutMs: number
): Promise<AgentTestResult> {
  const startTime = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const details = await Promise.race([testFn(), timeoutPromise]);
    const durationMs = Date.now() - startTime;

    return {
      test: name,
      status: "pass",
      durationMs,
      details,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      test: name,
      status: "fail",
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test gateway connectivity
 */
async function testGatewayConnectivity(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/status`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.ok) {
    throw new Error("Gateway status indicates not ok");
  }

  return { gateway: "connected", timestamp: data.time };
}

/**
 * Test health check endpoint
 */
async function testHealthCheck(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/status`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  return {
    health: data.health,
    startupHealthCheck: data.startupHealthCheck,
    mainAgent: data.mainAgent,
  };
}

/**
 * Test session management
 */
async function testSessionManagement(gatewayUrl: string): Promise<unknown> {
  // Get initial session count
  const listResponse = await fetch(`${gatewayUrl}/api/sessions`, {
    signal: AbortSignal.timeout(5000),
  });

  const listData = await listResponse.json();

  if (!listData.ok) {
    throw new Error("Failed to list sessions");
  }

  return {
    sessionCount: listData.sessions.length,
    sessionsAvailable: true,
  };
}

/**
 * Test task creation
 */
async function testTaskCreation(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "Diagnostic test task - verify agent can queue tasks",
      label: "diagnostic",
    }),
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Task creation failed: ${data.error || "Unknown error"}`);
  }

  return {
    taskId: data.id,
    status: data.status,
    createdAt: data.createdAt,
  };
}

/**
 * Test configuration retrieval
 */
async function testConfiguration(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/config`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error("Failed to retrieve configuration");
  }

  return {
    configPath: data.path,
    hasWorkspaceDir: !!data.config.workspaceDir,
    hasProviders: !!data.config.providers,
    providerCount: Object.keys(data.config.providers?.items || {}).length,
  };
}

/**
 * Test main agent status
 */
async function testMainAgentStatus(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/status`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  return {
    enabled: data.mainAgent?.enabled ?? false,
    running: data.mainAgent?.running ?? false,
    lastCheckAt: data.mainAgent?.lastCheckAt,
    lastError: data.mainAgent?.lastError,
  };
}

/**
 * Test channel status
 */
async function testChannelStatus(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/channels`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error("Failed to retrieve channel status");
  }

  return {
    channelCount: data.channels.length,
    channels: data.channels.map((c: { id: string; status?: { connected?: boolean } }) => ({
      id: c.id,
      connected: c.status?.connected ?? false,
    })),
  };
}

/**
 * Run all agent tests
 */
export async function runAgentTests(config: AgentTesterConfig): Promise<AgentTestSuite> {
  const timeoutMs = config.timeoutMs ?? 15000;
  const results: AgentTestResult[] = [];

  const tests = [
    { name: "Gateway Connectivity", fn: () => testGatewayConnectivity(config.gatewayUrl) },
    { name: "Health Check", fn: () => testHealthCheck(config.gatewayUrl) },
    { name: "Session Management", fn: () => testSessionManagement(config.gatewayUrl) },
    { name: "Task Creation", fn: () => testTaskCreation(config.gatewayUrl) },
    { name: "Configuration", fn: () => testConfiguration(config.gatewayUrl) },
    { name: "Main Agent Status", fn: () => testMainAgentStatus(config.gatewayUrl) },
    { name: "Channel Status", fn: () => testChannelStatus(config.gatewayUrl) },
  ];

  for (const { name, fn } of tests) {
    config.logger?.debug({ test: name }, "Running agent test");
    const result = await runTest(name, fn, timeoutMs);
    results.push(result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  return {
    name: "Agent Functionality",
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
export function formatAgentResults(suite: AgentTestSuite): string {
  const lines: string[] = [];

  lines.push(`\n${suite.name}`);
  lines.push("=".repeat(suite.name.length));

  for (const result of suite.results) {
    const icon = result.status === "pass" ? "✓" : result.status === "skip" ? "○" : "✗";
    const statusText = result.status.toUpperCase().padEnd(6);
    lines.push(`${icon} ${statusText} ${result.test} (${result.durationMs}ms)`);

    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }
  }

  lines.push("");
  lines.push(`Results: ${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped`);

  return lines.join("\n");
}

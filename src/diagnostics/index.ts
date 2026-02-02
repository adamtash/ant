/**
 * Diagnostics Module
 *
 * Master diagnostics runner that combines all test suites.
 */

import { runEndpointTests, formatEndpointResults } from "./endpoint-tester.js";
import { runAgentTests, formatAgentResults } from "./agent-tester.js";
import { runWhatsAppTests, formatWhatsAppResults } from "./whatsapp-tester.js";
import type { Logger } from "../log.js";

export interface DiagnosticsConfig {
  gatewayUrl: string;
  timeoutMs?: number;
  logger?: Logger;
}

export interface DiagnosticsResult {
  success: boolean;
  suites: Array<{
    name: string;
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  }>;
  summary: {
    totalPassed: number;
    totalFailed: number;
    totalSkipped: number;
    totalTests: number;
  };
}

/**
 * Run all diagnostic tests
 */
export async function runAllDiagnostics(config: DiagnosticsConfig): Promise<DiagnosticsResult> {
  config.logger?.info("Starting comprehensive diagnostics...");

  const [endpointSuite, agentSuite, whatsAppSuite] = await Promise.all([
    runEndpointTests({ baseUrl: config.gatewayUrl, timeoutMs: config.timeoutMs, logger: config.logger }),
    runAgentTests({ gatewayUrl: config.gatewayUrl, timeoutMs: config.timeoutMs, logger: config.logger }),
    runWhatsAppTests({ gatewayUrl: config.gatewayUrl, timeoutMs: config.timeoutMs, logger: config.logger }),
  ]);

  const suites = [
    {
      name: endpointSuite.name,
      passed: endpointSuite.passed,
      failed: endpointSuite.failed,
      skipped: endpointSuite.skipped,
      total: endpointSuite.total,
    },
    {
      name: agentSuite.name,
      passed: agentSuite.passed,
      failed: agentSuite.failed,
      skipped: agentSuite.skipped,
      total: agentSuite.total,
    },
    {
      name: whatsAppSuite.name,
      passed: whatsAppSuite.passed,
      failed: whatsAppSuite.failed,
      skipped: whatsAppSuite.skipped,
      total: whatsAppSuite.total,
    },
  ];

  const totalPassed = suites.reduce((sum, s) => sum + s.passed, 0);
  const totalFailed = suites.reduce((sum, s) => sum + s.failed, 0);
  const totalSkipped = suites.reduce((sum, s) => sum + s.skipped, 0);
  const totalTests = suites.reduce((sum, s) => sum + s.total, 0);

  const success = totalFailed === 0;

  return {
    success,
    suites,
    summary: {
      totalPassed,
      totalFailed,
      totalSkipped,
      totalTests,
    },
  };
}

/**
 * Format all diagnostic results for display
 */
export function formatDiagnosticsResults(result: DiagnosticsResult): string {
  const lines: string[] = [];

  lines.push("\n" + "=".repeat(60));
  lines.push("ANT DIAGNOSTICS REPORT");
  lines.push("=".repeat(60));

  // Individual suite results
  lines.push(formatEndpointResults({
    name: "HTTP Endpoints",
    results: [],
    passed: 0, failed: 0, skipped: 0, total: 0,
  }));

  lines.push(formatAgentResults({
    name: "Agent Functionality",
    results: [],
    passed: 0, failed: 0, skipped: 0, total: 0,
  }));

  lines.push(formatWhatsAppResults({
    name: "WhatsApp Integration",
    results: [],
    passed: 0, failed: 0, skipped: 0, total: 0,
  }));

  // Summary
  lines.push("\n" + "=".repeat(60));
  lines.push("SUMMARY");
  lines.push("=".repeat(60));

  for (const suite of result.suites) {
    const icon = suite.failed === 0 ? "✓" : "✗";
    lines.push(`${icon} ${suite.name}: ${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped`);
  }

  lines.push("-".repeat(60));
  lines.push(`Total: ${result.summary.totalPassed} passed, ${result.summary.totalFailed} failed, ${result.summary.totalSkipped} skipped`);

  if (result.success) {
    lines.push("\n✓ All diagnostics passed!");
  } else {
    lines.push("\n✗ Some diagnostics failed. Check details above.");
  }

  lines.push("=".repeat(60));

  return lines.join("\n");
}

// Re-export individual test functions for selective testing
export { runEndpointTests, formatEndpointResults } from "./endpoint-tester.js";
export { runAgentTests, formatAgentResults } from "./agent-tester.js";
export { runWhatsAppTests, formatWhatsAppResults } from "./whatsapp-tester.js";

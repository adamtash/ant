/**
 * Diagnostics: Test All Command
 *
 * Runs comprehensive diagnostics on the ANT system.
 */

import type { AntConfig } from "../../../config.js";
import type { Logger } from "../../../log.js";
import { OutputFormatter } from "../../output-formatter.js";
import {
  runAllDiagnostics,
  formatDiagnosticsResults,
  runEndpointTests,
  formatEndpointResults,
  runAgentTests,
  formatAgentResults,
  runWhatsAppTests,
  formatWhatsAppResults,
} from "../../../diagnostics/index.js";

interface TestAllOptions {
  gateway?: string;
  timeout?: string;
  json?: boolean;
  suite?: string;
}

export async function testAll(cfg: AntConfig, options: TestAllOptions): Promise<void> {
  const out = new OutputFormatter();

  // Determine gateway URL
  const gatewayUrl = options.gateway || `http://${cfg.gateway?.host || cfg.ui?.host || "127.0.0.1"}:${cfg.gateway?.port || cfg.ui?.port || 18789}`;
  const timeoutMs = parseInt(options.timeout || "300000", 10);

  out.header("ANT System Diagnostics");
  out.info(`Gateway: ${gatewayUrl}`);
  out.info(`Timeout: ${timeoutMs}ms`);

  if (options.suite) {
    // Run specific test suite
    await runSpecificSuite(out, gatewayUrl, timeoutMs, options.suite, options.json ?? false);
  } else {
    // Run all diagnostics
    await runAll(out, gatewayUrl, timeoutMs, options.json ?? false);
  }
}

async function runAll(
  out: OutputFormatter,
  gatewayUrl: string,
  timeoutMs: number,
  json: boolean
): Promise<void> {
  out.info("\nRunning all diagnostic tests...");

  try {
    const result = await runAllDiagnostics({
      gatewayUrl,
      timeoutMs,
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatDiagnosticsResults(result));
    }

    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    out.error(`\nDiagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function runSpecificSuite(
  out: OutputFormatter,
  gatewayUrl: string,
  timeoutMs: number,
  suite: string,
  json: boolean
): Promise<void> {
  out.info(`\nRunning ${suite} test suite...`);

  try {
    let result;

    switch (suite.toLowerCase()) {
      case "endpoints":
        result = await runEndpointTests({ baseUrl: gatewayUrl, timeoutMs });
        if (!json) {
          console.log(formatEndpointResults(result));
        }
        break;

      case "agent":
      case "agent-health":
        result = await runAgentTests({ gatewayUrl, timeoutMs });
        if (!json) {
          console.log(formatAgentResults(result));
        }
        break;

      case "whatsapp":
        result = await runWhatsAppTests({ gatewayUrl, timeoutMs });
        if (!json) {
          console.log(formatWhatsAppResults(result));
        }
        break;

      default:
        out.error(`Unknown test suite: ${suite}`);
        out.info("Available suites: endpoints, agent, whatsapp");
        process.exitCode = 1;
        return;
    }

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    }

    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (error) {
    out.error(`\nTest suite failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

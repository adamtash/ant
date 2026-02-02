/**
 * Diagnostics: Agent Health Command
 *
 * Tests agent startup, health, and basic functionality.
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { runAgentTests, formatAgentResults } from "../../../diagnostics/agent-tester.js";

interface AgentHealthOptions {
  gateway?: string;
  timeout?: string;
  json?: boolean;
}

export async function agentHealth(cfg: AntConfig, options: AgentHealthOptions): Promise<void> {
  const out = new OutputFormatter();

  const gatewayUrl = options.gateway || `http://${cfg.gateway?.host || cfg.ui?.host || "127.0.0.1"}:${cfg.gateway?.port || cfg.ui?.port || 18789}`;
  const timeoutMs = parseInt(options.timeout || "300000", 10);

  out.header("Agent Health Diagnostics");
  out.info(`Testing agent at: ${gatewayUrl}`);

  try {
    const result = await runAgentTests({
      gatewayUrl,
      timeoutMs,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatAgentResults(result));
    }

    if (result.failed === 0) {
      out.success("\nAgent is healthy!");
    } else {
      out.warn(`\n${result.failed} test(s) failed`);
    }

    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (error) {
    out.error(`\nAgent health check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

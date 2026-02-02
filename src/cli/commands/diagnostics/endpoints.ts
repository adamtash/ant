/**
 * Diagnostics: Endpoints Command
 *
 * Tests HTTP endpoints for availability and correct responses.
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { runEndpointTests, formatEndpointResults } from "../../../diagnostics/endpoint-tester.js";

interface EndpointsOptions {
  gateway?: string;
  timeout?: string;
  json?: boolean;
}

export async function endpoints(cfg: AntConfig, options: EndpointsOptions): Promise<void> {
  const out = new OutputFormatter();

  const gatewayUrl = options.gateway || `http://${cfg.gateway?.host || cfg.ui?.host || "127.0.0.1"}:${cfg.gateway?.port || cfg.ui?.port || 18789}`;
  const timeoutMs = parseInt(options.timeout || "30000", 10);

  out.header("Endpoint Diagnostics");
  out.info(`Testing endpoints at: ${gatewayUrl}`);

  try {
    const result = await runEndpointTests({
      baseUrl: gatewayUrl,
      timeoutMs,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatEndpointResults(result));
    }

    if (result.failed === 0) {
      out.success("\nAll endpoints are responding correctly!");
    } else {
      out.warn(`\n${result.failed} endpoint(s) failed`);
    }

    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (error) {
    out.error(`\nEndpoint testing failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

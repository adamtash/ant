/**
 * Diagnostics: WhatsApp Command
 *
 * Tests WhatsApp integration and message handling.
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { runWhatsAppTests, formatWhatsAppResults } from "../../../diagnostics/whatsapp-tester.js";

interface WhatsAppOptions {
  gateway?: string;
  timeout?: string;
  json?: boolean;
}

export async function whatsapp(cfg: AntConfig, options: WhatsAppOptions): Promise<void> {
  const out = new OutputFormatter();

  const gatewayUrl = options.gateway || `http://${cfg.gateway?.host || cfg.ui?.host || "127.0.0.1"}:${cfg.gateway?.port || cfg.ui?.port || 18789}`;
  const timeoutMs = parseInt(options.timeout || "30000", 10);

  out.header("WhatsApp Integration Diagnostics");
  out.info(`Testing WhatsApp at: ${gatewayUrl}`);

  try {
    const result = await runWhatsAppTests({
      gatewayUrl,
      timeoutMs,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatWhatsAppResults(result));
    }

    if (result.failed === 0) {
      out.success("\nWhatsApp integration is working!");
    } else {
      out.warn(`\n${result.failed} test(s) failed`);
    }

    process.exitCode = result.failed === 0 ? 0 : 1;
  } catch (error) {
    out.error(`\nWhatsApp testing failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

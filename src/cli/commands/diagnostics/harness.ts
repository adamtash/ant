/**
 * Diagnostics: Harness Command
 *
 * Runs a programmatic harness scenario against a real provider config, while:
 * - simulating WhatsApp inbound/outbound
 * - capturing logs + session artifacts
 *
 * Intended for iterative "polish loops" and future Main Agent self-improvement.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { startHarness, type HarnessMode } from "../../../testing/harness.js";

export interface HarnessOptions {
  mode?: string;
  message?: string;
  chatId?: string;
  selfJid?: string;
  timeout?: string;
  json?: boolean;
  cleanup?: boolean;
  workspaceDir?: string;
  enableMemory?: boolean;
  enableMainAgent?: boolean;
  enableScheduler?: boolean;
  launchTarget?: string;
  blockExecDeletes?: boolean;
}

export async function harness(cfg: AntConfig, options: HarnessOptions): Promise<void> {
  const out = new OutputFormatter();
  const mode = parseMode(options.mode);
  const message = (options.message ?? "").trim();
  if (!message) {
    throw new Error("Missing --message");
  }

  const timeoutMs = parseNumber(options.timeout, 60_000);
  const selfJid =
    (options.selfJid ?? "").trim() ||
    (process.env.ANT_TEST_WHATSAPP_SELF_JID ?? "").trim() ||
    (options.chatId ?? "").trim() ||
    "test-self@s.whatsapp.net";
  const chatId = ((options.chatId ?? "").trim() || selfJid).trim();

  const harnessInstance = await startHarness(mode, {
    configPath: cfg.resolved.configPath,
    workspaceDir: options.workspaceDir?.trim() || process.cwd(),
    testSelfJid: selfJid,
    blockExecDeletes: options.blockExecDeletes ?? true,
    isolated: true,
    enableMemory: options.enableMemory ?? false,
    enableMainAgent: options.enableMainAgent ?? false,
    enableScheduler: options.enableScheduler ?? false,
    launchTarget: options.launchTarget === "dist" ? "dist" : "src",
  });

  let completed = false;
  try {
    await harnessInstance.clearWhatsAppOutbound();

    const injected = await harnessInstance.sendWhatsAppText({
      chatId,
      text: message,
      senderId: "harness@s.whatsapp.net",
      pushName: "Harness",
      fromMe: false,
    });

    const outbound = injected.accepted
      ? await harnessInstance.waitForWhatsAppOutbound({ chatId, timeoutMs })
      : null;

    const report = {
      ok: true,
      mode: harnessInstance.mode,
      runId: harnessInstance.artifacts.runId,
      artifacts: harnessInstance.artifacts,
      injected,
      outbound,
    };

    const reportPath = path.join(harnessInstance.artifacts.tempDir, "harness-report.json");
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    if (options.json) {
      out.json(report);
      completed = true;
      return;
    }

    out.header("Harness Run Complete");
    out.keyValue("Mode", harnessInstance.mode);
    out.keyValue("Run ID", harnessInstance.artifacts.runId);
    out.keyValue("Temp Dir", harnessInstance.artifacts.tempDir);
    out.keyValue("Log File", harnessInstance.artifacts.logFilePath);
    if (harnessInstance.artifacts.gatewayUrl) {
      out.keyValue("Gateway", harnessInstance.artifacts.gatewayUrl);
    }
    out.keyValue("Report", reportPath);
    out.keyValue("Injected", injected.accepted ? "accepted" : "filtered");
    if (outbound) {
      out.section("Outbound (first)");
      out.box(outbound.content, "Response");
    }

    completed = true;
  } finally {
    await harnessInstance.stop();

    if (options.cleanup) {
      try {
        await fs.rm(harnessInstance.artifacts.tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    // In-process harness mode can leave open handles (tsx/esbuild, logger streams, etc.).
    // Force a clean exit when the command completes successfully.
    if (completed && mode === "in_process") {
      process.exit(0);
    }
  }
}

function parseMode(value: string | undefined): HarnessMode {
  const v = (value ?? "child_process").trim().toLowerCase();
  if (v === "in_process") return "in_process";
  if (v === "child_process") return "child_process";
  throw new Error(`Invalid --mode: ${value} (expected in_process or child_process)`);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

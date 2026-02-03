/**
 * Diagnostics: E2E Runner
 *
 * Runs a multi-scenario programmatic harness against the configured providers.
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { runE2E } from "../../../testing/e2e-runner.js";

export interface E2EOptions {
  mode?: string;
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

export async function e2e(cfg: AntConfig, options: E2EOptions): Promise<void> {
  const out = new OutputFormatter();
  const timeoutMs = parseNumber(options.timeout, 120_000);

  const report = await runE2E({
    configPath: cfg.resolved.configPath,
    mode: options.mode,
    selfJid: options.selfJid,
    chatId: options.chatId,
    timeoutMs,
    workspaceDir: options.workspaceDir?.trim(),
    enableMemory: options.enableMemory ?? false,
    enableMainAgent: options.enableMainAgent ?? false,
    enableScheduler: options.enableScheduler ?? false,
    launchTarget: options.launchTarget,
    blockExecDeletes: options.blockExecDeletes ?? true,
    cleanup: options.cleanup ?? false,
  });

  if (options.json) {
    out.json(report);
    return;
  }

  out.header("E2E Harness Report");
  out.keyValue("Mode", report.mode);
  out.keyValue("Run ID", report.runId);
  out.keyValue("Workspace", report.workspaceDir);
  out.keyValue("Temp Dir", report.artifacts.tempDir);
  out.keyValue("State Dir", report.artifacts.stateDir);
  out.keyValue("Log File", report.artifacts.logFilePath);
  if (report.artifacts.gatewayUrl) out.keyValue("Gateway", report.artifacts.gatewayUrl);
  out.keyValue("Report", report.reportPath);
  out.keyValue("OK", report.ok ? "true" : "false");
  out.keyValue("Log Warnings", String(report.logs.warnCount));
  out.keyValue("Log Errors", String(report.logs.errorCount));

  out.section("Scenarios");
  for (const s of report.scenarios) {
    out.keyValue(`${s.ok ? "PASS" : "FAIL"} ${s.id}`, s.description);
    if (!s.ok && s.error) {
      out.keyValue("  error", s.error);
    }
    const mediaCount = s.outboundAll.filter((m) => Boolean(m.media)).length;
    out.keyValue("  outbound", String(s.outboundAll.length));
    out.keyValue("  media", String(mediaCount));
  }
}

function parseNumber(value: string | undefined, fallback: number): number {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Sessions Export Command - Export a session
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { ValidationError, RuntimeError } from "../../error-handler.js";
import { ensureRuntimePaths } from "../../../gateway/process-control.js";
import { SessionManager, type SessionMessage } from "../../../gateway/session-manager.js";
import { createLogger } from "../../../log.js";

export interface SessionsExportOptions {
  config?: string;
  format?: "json" | "markdown" | "text";
  output?: string;
  json?: boolean;
  quiet?: boolean;
}

/**
 * Export a session
 */
export async function sessionsExport(cfg: AntConfig, sessionKey: string, options: SessionsExportOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!sessionKey?.trim()) {
    throw new ValidationError("Session key is required", "Use 'ant sessions list' to see available sessions.");
  }

  const paths = await ensureRuntimePaths(cfg);
  const logger = createLogger("silent");
  const sessionManager = new SessionManager({ stateDir: paths.stateDir, logger });

  const messages = await sessionManager.readMessages(sessionKey.trim());

  if (messages.length === 0) {
    throw new RuntimeError(`Session "${sessionKey}" has no messages or does not exist.`);
  }

  const format = options.format || "json";
  const safeKey = sessionKey.replace(/[^a-zA-Z0-9-_]/g, "_");
  const defaultOutput = path.join(process.cwd(), `session-${safeKey}-${Date.now()}.${format === "markdown" ? "md" : format === "text" ? "txt" : "json"}`);
  const outputPath = options.output || defaultOutput;

  let content: string;

  switch (format) {
    case "markdown":
      content = exportAsMarkdown(sessionKey, messages);
      break;
    case "text":
      content = exportAsText(messages);
      break;
    case "json":
    default:
      content = JSON.stringify(messages, null, 2);
      break;
  }

  await fs.writeFile(outputPath, content, "utf-8");

  if (options.json) {
    out.json({ success: true, format, outputPath, messageCount: messages.length });
    return;
  }

  out.success(`Session exported to ${outputPath}`);
  out.keyValue("Format", format);
  out.keyValue("Messages", messages.length);
}

/**
 * Extended message type for export with optional toolCalls
 */
interface ExportMessage extends SessionMessage {
  toolCalls?: Array<{ name: string; arguments: unknown }>;
}

/**
 * Export as Markdown
 */
function exportAsMarkdown(sessionKey: string, messages: SessionMessage[]): string {
  const lines: string[] = [
    `# Session: ${sessionKey}`,
    "",
    `Exported: ${new Date().toISOString()}`,
    `Messages: ${messages.length}`,
    "",
    "---",
    "",
  ];

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toISOString();
    const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(msg.content || "(no content)");
    lines.push("");

    const exportMsg = msg as ExportMessage;
    if (exportMsg.toolCalls && exportMsg.toolCalls.length > 0) {
      lines.push("**Tool Calls:**");
      for (const tc of exportMsg.toolCalls) {
        lines.push(`- \`${tc.name}\`: ${JSON.stringify(tc.arguments)}`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Export as plain text
 */
function exportAsText(messages: SessionMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleString();
    const role = msg.role.toUpperCase();

    lines.push(`[${time}] ${role}:`);
    lines.push(msg.content || "(no content)");
    lines.push("");
  }

  return lines.join("\n");
}

export default sessionsExport;

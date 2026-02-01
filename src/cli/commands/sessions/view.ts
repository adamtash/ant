/**
 * Sessions View Command - View a specific session
 */

import type { AntConfig } from "../../../config.js";
import { OutputFormatter } from "../../output-formatter.js";
import { ValidationError } from "../../error-handler.js";
import { ensureRuntimePaths } from "../../../gateway/process-control.js";
import { SessionManager, type SessionMessage } from "../../../gateway/session-manager.js";
import { createLogger } from "../../../log.js";
import chalk from "chalk";

export interface SessionsViewOptions {
  config?: string;
  lines?: number;
  json?: boolean;
  quiet?: boolean;
}

/**
 * View a specific session
 */
export async function sessionsView(cfg: AntConfig, sessionKey: string, options: SessionsViewOptions = {}): Promise<void> {
  const out = new OutputFormatter({ quiet: options.quiet });

  if (!sessionKey?.trim()) {
    throw new ValidationError("Session key is required", "Use 'ant sessions list' to see available sessions.");
  }

  const paths = await ensureRuntimePaths(cfg);
  const logger = createLogger("silent");
  const sessionManager = new SessionManager({ stateDir: paths.stateDir, logger });

  const messages = await sessionManager.readMessages(sessionKey.trim());

  if (messages.length === 0) {
    out.info(`Session "${sessionKey}" has no messages or does not exist.`);
    return;
  }

  // Apply line limit
  const limit = options.lines ?? messages.length;
  const displayMessages = messages.slice(-limit);

  if (options.json) {
    out.json(displayMessages);
    return;
  }

  out.header(`Session: ${sessionKey}`);
  out.keyValue("Total Messages", messages.length);
  if (limit < messages.length) {
    out.keyValue("Showing", `last ${limit} messages`);
  }
  out.newline();

  for (const msg of displayMessages) {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    const role = msg.role.toUpperCase().padEnd(10);

    let roleColor: (s: string) => string;
    switch (msg.role) {
      case "user":
        roleColor = chalk.green;
        break;
      case "assistant":
        roleColor = chalk.blue;
        break;
      case "system":
        roleColor = chalk.magenta;
        break;
      case "tool":
        roleColor = chalk.yellow;
        break;
      default:
        roleColor = chalk.white;
    }

    console.log(`${chalk.dim(time)} ${roleColor(role)}`);

    // Handle content display
    const content = msg.content || "";
    if (content.length > 500) {
      console.log(content.slice(0, 500) + chalk.dim("... (truncated)"));
    } else {
      console.log(content);
    }

    // Show tool call info if present
    if (msg.toolCallId) {
      console.log(chalk.dim(`  Tool call ID: ${msg.toolCallId}`));
    }
    if (msg.name) {
      console.log(chalk.dim(`  Tool name: ${msg.name}`));
    }

    console.log();
  }
}

export default sessionsView;

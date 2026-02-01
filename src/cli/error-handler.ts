/**
 * Error Handler - Consistent error reporting for CLI commands
 */

import chalk from "chalk";
import type { AntConfig } from "../config.js";

/**
 * Base CLI error class
 */
export class CliError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;
  readonly suggestion?: string;

  constructor(message: string, options: { code: string; details?: Record<string, unknown>; suggestion?: string } = { code: "CLI_ERROR" }) {
    super(message);
    this.name = "CliError";
    this.code = options.code;
    this.details = options.details;
    this.suggestion = options.suggestion;
  }
}

/**
 * Configuration error
 */
export class ConfigError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, { code: "CONFIG_ERROR", suggestion });
    this.name = "ConfigError";
  }
}

/**
 * Runtime error (agent not running, etc)
 */
export class RuntimeError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, { code: "RUNTIME_ERROR", suggestion });
    this.name = "RuntimeError";
  }
}

/**
 * Connection error (API, network, etc)
 */
export class ConnectionError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, { code: "CONNECTION_ERROR", suggestion });
    this.name = "ConnectionError";
  }
}

/**
 * Validation error (invalid input, etc)
 */
export class ValidationError extends CliError {
  constructor(message: string, suggestion?: string) {
    super(message, { code: "VALIDATION_ERROR", suggestion });
    this.name = "ValidationError";
  }
}

/**
 * Error codes with user-friendly messages
 */
const ERROR_MESSAGES: Record<string, { title: string; help: string }> = {
  CONFIG_ERROR: {
    title: "Configuration Error",
    help: "Check your ant.config.json file for issues.",
  },
  RUNTIME_ERROR: {
    title: "Runtime Error",
    help: "Make sure the agent is running with 'ant start'.",
  },
  CONNECTION_ERROR: {
    title: "Connection Error",
    help: "Check your network connection and API settings.",
  },
  VALIDATION_ERROR: {
    title: "Validation Error",
    help: "Check the command arguments and try again.",
  },
  CLI_ERROR: {
    title: "CLI Error",
    help: "Run 'ant --help' for usage information.",
  },
};

/**
 * Format an error for display
 */
export function formatError(err: unknown, verbose = false): string {
  const lines: string[] = [];

  if (err instanceof CliError) {
    const meta = ERROR_MESSAGES[err.code] ?? ERROR_MESSAGES.CLI_ERROR;
    lines.push(chalk.red.bold(`${meta.title}: `) + err.message);

    if (err.suggestion) {
      lines.push(chalk.yellow("Suggestion: ") + err.suggestion);
    } else {
      lines.push(chalk.dim(`Hint: ${meta.help}`));
    }

    if (verbose && err.details) {
      lines.push(chalk.dim("\nDetails:"));
      lines.push(chalk.dim(JSON.stringify(err.details, null, 2)));
    }
  } else if (err instanceof Error) {
    lines.push(chalk.red.bold("Error: ") + err.message);

    if (verbose && err.stack) {
      lines.push(chalk.dim("\nStack trace:"));
      lines.push(chalk.dim(err.stack));
    }
  } else {
    lines.push(chalk.red.bold("Error: ") + String(err));
  }

  return lines.join("\n");
}

/**
 * Handle an error and exit with appropriate code, or execute an async function with error handling.
 */
export async function handleError(errOrFn: unknown | (() => Promise<unknown>), verbose = false): Promise<void> {
  if (typeof errOrFn === "function") {
    try {
      await errOrFn();
      return;
    } catch (err) {
      handleError(err, verbose);
      return;
    }
  }

  const err = errOrFn;
  console.error(formatError(err, verbose));
  process.exitCode = 1;
  // If we're just reporting an error, we don't necessarily need to throw
  // unless we want to bubble up. But for CLI entry points, setting exitCode is enough.
  // However, keeping throw ensures we stop execution if this was called directly.
  throw err;
}

/**
 * Wrap an async command handler with error handling
 */
export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  options: { verbose?: boolean } = {}
): (...args: T) => Promise<R | undefined> {
  return async (...args: T): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(formatError(err, options.verbose));
      process.exitCode = 1;
      return undefined;
    }
  };
}

/**
 * Check if the runtime is accessible
 */
export async function ensureRuntimeRunning(cfg: AntConfig): Promise<void> {
  if (!cfg.ui.enabled) return;

  const base = `http://${cfg.ui.host}:${cfg.ui.port}`;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(`${base}/api/status`, { signal: ctrl.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new RuntimeError("Agent runtime is not responding", "Start the agent with 'ant start'");
    }
  } catch (err) {
    if (err instanceof RuntimeError) throw err;
    throw new RuntimeError("Cannot connect to agent runtime", "Start the agent with 'ant start'");
  }
}

/**
 * Validate required arguments
 */
export function validateArgs(args: Record<string, unknown>, required: string[]): void {
  const missing = required.filter((key) => args[key] === undefined || args[key] === null || args[key] === "");

  if (missing.length > 0) {
    throw new ValidationError(`Missing required argument(s): ${missing.join(", ")}`, `Provide the missing arguments and try again`);
  }
}

/**
 * Parse and validate JSON input
 */
export function parseJsonArg(value: string, name: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      throw new ValidationError(`${name} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Invalid JSON for ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Display a user-friendly message for common errors
 */
export function getErrorHelp(err: unknown): string | null {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    if (msg.includes("econnrefused")) {
      return "The agent is not running. Start it with 'ant start'.";
    }

    if (msg.includes("no models loaded")) {
      return "No LLM model is loaded. Check your LM Studio or provider settings.";
    }

    if (msg.includes("api key")) {
      return "API key is missing or invalid. Check your configuration.";
    }

    if (msg.includes("enoent")) {
      return "A required file or directory was not found. Run 'ant doctor' to diagnose.";
    }
  }

  return null;
}

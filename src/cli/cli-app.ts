/**
 * CLI App - Main Commander.js setup with all commands
 */

import { Command } from "commander";
import { loadConfig, resolveConfigPath } from "../config.js";
import { withErrorHandling, formatError } from "./error-handler.js";
import { OutputFormatter } from "./output-formatter.js";

// Import command handlers
import { start } from "./commands/runtime/start.js";
import { stop } from "./commands/runtime/stop.js";
import { restart } from "./commands/runtime/restart.js";
import { status } from "./commands/runtime/status.js";
import { ask } from "./commands/agent/ask.js";
import { runTask } from "./commands/agent/run-task.js";
import { listTasks } from "./commands/agent/list-tasks.js";
import { listTools } from "./commands/tools/list.js";
import { toolDetails } from "./commands/tools/details.js";
import { scheduleAdd } from "./commands/schedule/add.js";
import { scheduleList } from "./commands/schedule/list.js";
import { scheduleRun } from "./commands/schedule/run.js";
import { scheduleRemove } from "./commands/schedule/remove.js";
import { remember } from "./commands/memory/remember.js";
import { recall } from "./commands/memory/recall.js";
import { memoryExport } from "./commands/memory/export.js";
import { logs } from "./commands/monitoring/logs.js";
import { dashboard } from "./commands/monitoring/dashboard.js";
import { sessionsList } from "./commands/sessions/list.js";
import { sessionsView } from "./commands/sessions/view.js";
import { sessionsExport } from "./commands/sessions/export.js";
import { sessionsClear } from "./commands/sessions/clear.js";
import { doctor } from "./doctor.js";
import { onboard } from "./onboard.js";

/**
 * Create and configure the CLI program
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("ant")
    .description("ANT CLI - Your AI agent runtime")
    .version("0.1.0")
    .option("-c, --config <path>", "Path to ant.config.json")
    .option("--json", "Output in JSON format")
    .option("--quiet", "Suppress non-essential output");

  // ============================================================================
  // Runtime Commands
  // ============================================================================

  program
    .command("start")
    .description("Start the agent runtime")
    .option("--tui", "Show TUI dashboard")
    .option("--detached", "Run in background")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await start(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("stop")
    .description("Stop the running agent")
    .option("--force", "Force stop")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await stop(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("restart")
    .description("Restart the agent")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await restart(cfg, cmd.parent?.opts());
    }));

  program
    .command("status")
    .description("Show runtime status")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await status(cfg, cmd.parent?.opts());
    }));

  // ============================================================================
  // Agent Commands
  // ============================================================================

  program
    .command("ask <prompt>")
    .description("Ask the agent a one-off question")
    .option("-s, --session <key>", "Session key to use")
    .action(withErrorHandling(async (prompt, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await ask(cfg, prompt, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("run-task <description>")
    .description("Spawn a long-running task")
    .option("-l, --label <label>", "Task label")
    .option("-w, --wait", "Wait for completion")
    .action(withErrorHandling(async (description, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await runTask(cfg, description, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("list-tasks")
    .description("Show active tasks")
    .option("-a, --all", "Show all tasks including completed")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await listTasks(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  // ============================================================================
  // Tools Commands
  // ============================================================================

  program
    .command("list-tools")
    .description("Show all available tools")
    .option("--category <category>", "Filter by category")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await listTools(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("tool <name>")
    .description("Get tool details")
    .action(withErrorHandling(async (name, _options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await toolDetails(cfg, name, cmd.parent?.opts());
    }));

  // ============================================================================
  // Schedule Commands
  // ============================================================================

  const schedule = program.command("schedule").description("Manage scheduled jobs");

  schedule
    .command("add <cron>")
    .description("Add a scheduled job")
    .option("-n, --name <name>", "Job name")
    .option("-p, --prompt <prompt>", "Agent prompt to run")
    .option("-t, --tool <tool>", "Tool to call")
    .option("-a, --args <json>", "Tool arguments as JSON")
    .option("--disabled", "Create as disabled")
    .action(withErrorHandling(async (cron, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await scheduleAdd(cfg, cron, {
        ...options,
        enabled: !options.disabled,
        ...cmd.parent?.parent?.opts(),
      });
    }));

  schedule
    .command("list")
    .description("List scheduled jobs")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await scheduleList(cfg, cmd.parent?.parent?.opts());
    }));

  schedule
    .command("run <jobId>")
    .description("Manually run a scheduled job")
    .option("-w, --wait", "Wait for completion")
    .action(withErrorHandling(async (jobId, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await scheduleRun(cfg, jobId, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  schedule
    .command("remove <jobId>")
    .description("Remove a scheduled job")
    .option("--force", "Skip confirmation")
    .action(withErrorHandling(async (jobId, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await scheduleRemove(cfg, jobId, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  // ============================================================================
  // Memory Commands
  // ============================================================================

  program
    .command("remember <note>")
    .description("Add a note to memory")
    .option("--category <category>", "Note category")
    .option("--tags <tags>", "Comma-separated tags")
    .action(withErrorHandling(async (note, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await remember(cfg, note, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("recall <query>")
    .description("Search memory")
    .option("-l, --limit <n>", "Max results", parseInt)
    .option("--min-score <score>", "Minimum match score", parseFloat)
    .action(withErrorHandling(async (query, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await recall(cfg, query, { ...options, ...cmd.parent?.opts() });
    }));

  const memory = program.command("memory").description("Memory utilities");

  memory
    .command("export")
    .description("Export memory database")
    .option("-f, --format <format>", "Export format (json/sqlite/markdown)", "json")
    .option("-o, --output <path>", "Output file path")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await memoryExport(cfg, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  // ============================================================================
  // Monitoring Commands
  // ============================================================================

  program
    .command("logs")
    .description("Tail live logs")
    .option("-n, --lines <n>", "Number of lines to show", parseInt)
    .option("-f, --follow", "Follow log output", true)
    .option("-l, --level <level>", "Minimum log level")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await logs(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("dashboard")
    .description("Show TUI dashboard")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await dashboard(cfg, cmd.parent?.opts());
    }));

  // ============================================================================
  // Sessions Commands
  // ============================================================================

  const sessions = program.command("sessions").description("Session management");

  sessions
    .command("list")
    .description("List all sessions")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await sessionsList(cfg, cmd.parent?.parent?.opts());
    }));

  sessions
    .command("view <sessionKey>")
    .description("View a session")
    .option("-n, --lines <n>", "Number of messages to show", parseInt)
    .action(withErrorHandling(async (sessionKey, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await sessionsView(cfg, sessionKey, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  sessions
    .command("export <sessionKey>")
    .description("Export a session")
    .option("-f, --format <format>", "Export format (json/markdown/text)", "json")
    .option("-o, --output <path>", "Output file path")
    .action(withErrorHandling(async (sessionKey, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await sessionsExport(cfg, sessionKey, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  sessions
    .command("clear [sessionKey]")
    .description("Clear a session")
    .option("-a, --all", "Clear all sessions")
    .option("--force", "Skip confirmation")
    .action(withErrorHandling(async (sessionKey, options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      await sessionsClear(cfg, sessionKey, { ...options, ...cmd.parent?.parent?.opts() });
    }));

  // ============================================================================
  // Utility Commands
  // ============================================================================

  program
    .command("doctor")
    .description("Run health checks")
    .option("--fix", "Attempt to fix issues")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await doctor(cfg, { ...options, ...cmd.parent?.opts() });
    }));

  program
    .command("onboard")
    .description("Interactive setup wizard")
    .option("--force", "Overwrite existing config")
    .action(withErrorHandling(async (options, cmd) => {
      await onboard({ ...options, config: cmd.parent?.opts().config });
    }));

  // ============================================================================
  // Legacy Commands (for backwards compatibility with existing cli.ts)
  // ============================================================================

  program
    .command("run")
    .description("Start the WhatsApp listener and agent runtime (alias for start)")
    .option("--tui", "Show a live TUI with agent/subagent status")
    .action(withErrorHandling(async (options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.opts().config);
      await start(cfg, { tui: options.tui, ...cmd.parent?.opts() });
    }));

  // Debug commands
  const debug = program.command("debug").description("Debug utilities");

  debug
    .command("run <prompt>")
    .description("Run a one-off agent prompt without WhatsApp")
    .action(withErrorHandling(async (prompt, _options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      const out = new OutputFormatter({ quiet: cmd.parent?.parent?.opts().quiet });
      out.warn("'ant debug run' is deprecated. Use 'ant ask' instead.");
      await ask(cfg, prompt, cmd.parent?.parent?.opts());
    }));

  debug
    .command("simulate <text>")
    .description("Simulate an inbound WhatsApp message")
    .action(withErrorHandling(async (text, _options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      const out = new OutputFormatter({ quiet: cmd.parent?.parent?.opts().quiet });
      out.warn("'ant debug simulate' is deprecated. Use 'ant ask' instead.");
      await ask(cfg, text, cmd.parent?.parent?.opts());
    }));

  // MCP server command
  program
    .command("mcp-server")
    .description("Run ant MCP server over stdio")
    .action(withErrorHandling(async (_options, _cmd) => {
      const out = new OutputFormatter();
      out.error("MCP server mode is not yet available in the new architecture.");
      out.info("This feature will be added in a future release.");
      process.exitCode = 1;
    }));

  // Subagents commands
  const subagents = program.command("subagents").description("Subagent utilities");

  subagents
    .command("list")
    .description("List active subagents")
    .action(withErrorHandling(async (_options, cmd) => {
      const cfg = await loadConfig(cmd.parent?.parent?.opts().config);
      const out = new OutputFormatter({ quiet: cmd.parent?.parent?.opts().quiet });
      out.warn("'ant subagents list' is deprecated. Use 'ant list-tasks' instead.");
      await listTasks(cfg, { all: true, ...cmd.parent?.parent?.opts() });
    }));

  subagents
    .command("cleanup")
    .description("Cleanup inactive subagents")
    .action(withErrorHandling(async (_options, _cmd) => {
      const out = new OutputFormatter();
      out.warn("'ant subagents cleanup' is deprecated.");
      out.info("Tasks are automatically cleaned up by the runtime.");
    }));

  return program;
}

/**
 * Run the CLI
 */
export async function runCli(args: string[] = process.argv): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(args);
  } catch (err) {
    console.error(formatError(err));
    process.exitCode = 1;
  }
}

export default createProgram;

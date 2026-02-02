/**
 * ANT CLI - Main CLI Application
 *
 * This is the new unified CLI entry point that brings together all components.
 * It provides a discoverable, user-friendly interface to the ANT agent system.
 *
 * PROOF OF ACCESS: Modified by ANT agent at 2026-02-02T13:59:56.793Z
 * This comment demonstrates the agent has full read/write access to its own source code.
 */

import { Command } from "commander";
import { loadConfig } from "./config.js";
import { OutputFormatter } from "./cli/output-formatter.js";
import { handleError } from "./cli/error-handler.js";

// Import runtime commands
import { start } from "./cli/commands/runtime/start.js";
import { stop } from "./cli/commands/runtime/stop.js";
import { restart } from "./cli/commands/runtime/restart.js";
import { status } from "./cli/commands/runtime/status.js";

// Import agent commands
import { ask } from "./cli/commands/agent/ask.js";
import { runTask } from "./cli/commands/agent/run-task.js";
import { listTasks } from "./cli/commands/agent/list-tasks.js";

// Import tool commands
import { listTools } from "./cli/commands/tools/list.js";
import { toolDetails } from "./cli/commands/tools/details.js";

// Import schedule commands
import { scheduleAdd } from "./cli/commands/schedule/add.js";
import { scheduleList } from "./cli/commands/schedule/list.js";
import { scheduleRun } from "./cli/commands/schedule/run.js";
import { scheduleRemove } from "./cli/commands/schedule/remove.js";

// Import memory commands
import { remember } from "./cli/commands/memory/remember.js";
import { recall } from "./cli/commands/memory/recall.js";
import { memoryExport } from "./cli/commands/memory/export.js";

// Import monitoring commands
import { logs } from "./cli/commands/monitoring/logs.js";
import { dashboard } from "./cli/commands/monitoring/dashboard.js";

// Import session management commands
import { sessionsList } from "./cli/commands/sessions/list.js";
import { sessionsView } from "./cli/commands/sessions/view.js";
import { sessionsClear } from "./cli/commands/sessions/clear.js";

// Import diagnostics commands
import { testAll, endpoints, agentHealth, whatsapp } from "./cli/commands/diagnostics/index.js";

const program = new Command();
const out = new OutputFormatter();

program
  .name("ant")
  .description("ANT - Autonomous Agent CLI")
  .version("0.1.0")
  .option("-c, --config <path>", "Path to ant.config.json")
  .option("-q, --quiet", "Quiet mode - minimal output")
  .option("--no-color", "Disable colored output");

// =============================================================================
// RUNTIME MANAGEMENT
// =============================================================================

program
  .command("start")
  .description("Start the agent runtime")
  .option("--tui", "Show a live TUI with agent status")
  .option("-d, --detached", "Run in background")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => start(cfg, options));
  });

program
  .command("stop")
  .description("Stop the running agent")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => stop(cfg, options));
  });

program
  .command("restart")
  .description("Restart the agent")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => restart(cfg, options));
  });

program
  .command("status")
  .description("Show runtime status and queue depth")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => status(cfg, options));
  });

// =============================================================================
// AGENT INTERACTION
// =============================================================================

program
  .command("ask")
  .description("Ask the agent a one-off question")
  .argument("<prompt>", "The question or task")
  .option("--json", "Output as JSON")
  .action(async (prompt, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => ask(cfg, prompt, options));
  });

program
  .command("run-task")
  .description("Spawn a long-running background task")
  .argument("<description>", "Task description")
  .option("-l, --label <label>", "Label for tracking")
  .option("--wait", "Wait for task to complete")
  .action(async (description, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => runTask(cfg, description, options));
  });

program
  .command("list-tasks")
  .description("Show active and completed tasks")
  .option("-a, --all", "Show all tasks including completed")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => listTasks(cfg, options));
  });

// =============================================================================
// TOOLS & SKILLS
// =============================================================================

program
  .command("list-tools")
  .description("Show all available tools")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => listTools(cfg, options));
  });

program
  .command("tool")
  .description("Get tool details and usage examples")
  .argument("<name>", "Tool name")
  .action(async (name, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => toolDetails(cfg, name, options));
  });

// =============================================================================
// SCHEDULING (CRON)
// =============================================================================

const schedule = program.command("schedule").description("Manage scheduled jobs");

schedule
  .command("add")
  .description("Add a new scheduled job")
  .requiredOption("-n, --name <name>", "Job name")
  .requiredOption("-s, --schedule <cron>", "Cron schedule expression")
  .requiredOption("-p, --prompt <prompt>", "Agent prompt to run")
  .option("--enabled", "Enable job immediately", true)
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => scheduleAdd(cfg, options));
  });

schedule
  .command("list")
  .description("Show all scheduled jobs")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => scheduleList(cfg, options));
  });

schedule
  .command("run")
  .description("Execute a job immediately")
  .argument("<id>", "Job ID")
  .action(async (id, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => scheduleRun(cfg, id, options));
  });

schedule
  .command("remove")
  .description("Delete a scheduled job")
  .argument("<id>", "Job ID")
  .option("-f, --force", "Skip confirmation")
  .action(async (id, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => scheduleRemove(cfg, id, options));
  });

// =============================================================================
// MEMORY
// =============================================================================

program
  .command("remember")
  .description("Add a note to long-term memory")
  .argument("<note>", "Note to remember")
  .option("--category <category>", "Category for the note")
  .action(async (note, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => remember(cfg, note, options));
  });

program
  .command("recall")
  .description("Search memory for relevant context")
  .argument("<query>", "Search query")
  .option("-n, --max <n>", "Maximum results", "6")
  .option("--json", "Output as JSON")
  .action(async (query, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => recall(cfg, query, options));
  });

program
  .command("memory-export")
  .description("Export all memory to a file")
  .option("-o, --output <path>", "Output file path")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => memoryExport(cfg, options));
  });

// =============================================================================
// MONITORING
// =============================================================================

program
  .command("logs")
  .description("Tail live logs")
  .option("-f, --filter <level>", "Filter by log level")
  .option("-n, --lines <n>", "Number of lines to show", "50")
  .option("--follow", "Follow log output", true)
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => logs(cfg, options));
  });

program
  .command("dashboard")
  .description("Show TUI dashboard")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => dashboard(cfg, options));
  });

program
  .command("monitor")
  .description("Open web dashboard")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    const url = `http://${cfg.ui.host}:${cfg.ui.port}`;
    out.info(`Opening dashboard: ${url}`);
    const { exec } = await import("node:child_process");
    exec(`open ${url}`);
  });

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

const sessions = program.command("sessions").description("Manage sessions");

sessions
  .command("list")
  .description("Show all sessions")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => sessionsList(cfg, options));
  });

sessions
  .command("view")
  .description("View session details")
  .argument("<id>", "Session ID")
  .action(async (sessionKey, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => sessionsView(cfg, sessionKey, options));
  });

sessions
  .command("clear")
  .description("Clear session history")
  .argument("<id>", "Session ID")
  .option("-f, --force", "Skip confirmation")
  .action(async (sessionKey, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => sessionsClear(cfg, sessionKey, options));
  });

// =============================================================================
// LEGACY COMMANDS (deprecated - use new commands instead)
// =============================================================================

program
  .command("run")
  .description("Start the agent runtime (alias for 'ant start')")
  .option("--tui", "Show a live TUI with agent status")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    out.warn("'ant run' is deprecated. Use 'ant start' instead.");
    await handleError(() => start(cfg, { ...options, tui: Boolean(options.tui) }));
  });

const debug = program.command("debug").description("Debug utilities");
debug
  .command("run")
  .description("Run a one-off agent prompt (alias for 'ant ask')")
  .argument("<prompt>", "Prompt text")
  .action(async (prompt, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    out.warn("'ant debug run' is deprecated. Use 'ant ask' instead.");
    await handleError(() => ask(cfg, prompt, options));
  });

debug
  .command("simulate")
  .description("Simulate an inbound message")
  .argument("<text>", "Message text")
  .action(async (text, options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    out.warn("'ant debug simulate' is deprecated. Use 'ant ask' instead.");
    await handleError(() => ask(cfg, text, options));
  });

const subagents = program.command("subagents").description("Subagent utilities");
subagents
  .command("list")
  .description("List active tasks")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    out.warn("'ant subagents list' is deprecated. Use 'ant list-tasks' instead.");
    await handleError(() => listTasks(cfg, { all: true }));
  });

subagents
  .command("cleanup")
  .description("Clean up stale tasks")
  .action(async () => {
    out.warn("'ant subagents cleanup' is deprecated.");
    out.info("Tasks are automatically cleaned up by the runtime.");
  });

program
  .command("mcp-server")
  .description("Run ANT as MCP server over stdio")
  .action(async () => {
    out.error("MCP server mode is not yet available in the new architecture.");
    out.info("This feature will be added in a future release.");
    process.exitCode = 1;
  });

// =============================================================================
// NEW COMMANDS (inspired by OpenClaw)
// =============================================================================

program
  .command("doctor")
  .description("Check system health and configuration")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config).catch(() => null);
    out.header("ANT Health Check");

    // Check config
    if (cfg) {
      out.success("Configuration loaded");
      out.keyValue("Config path", cfg.resolved.configPath);
      out.keyValue("Workspace", cfg.resolved.workspaceDir);
    } else {
      out.error("Configuration not found");
    }

    // Check providers
    out.section("Providers");
    if (cfg?.resolved.providers) {
      for (const [id, provider] of Object.entries(cfg.resolved.providers.items)) {
        out.keyValue(id, `${provider.type} (${provider.model})`);
      }
    }

    // Check directories
    out.section("Directories");
    const fs = await import("node:fs/promises");
    const dirs = [
      { name: "State", path: cfg?.resolved.stateDir },
      { name: "WhatsApp Session", path: cfg?.resolved.whatsappSessionDir },
      { name: "Memory DB", path: cfg?.resolved.memorySqlitePath },
    ];
    for (const dir of dirs) {
      if (dir.path) {
        try {
          await fs.access(dir.path);
          out.keyValue(dir.name, `✓ ${dir.path}`);
        } catch {
          out.keyValue(dir.name, `✗ ${dir.path} (not found)`);
        }
      }
    }

    out.newline();
    out.success("Health check complete");
  });

program
  .command("onboard")
  .description("Interactive setup wizard")
  .action(async () => {
    out.header("ANT Setup Wizard");
    out.info("This wizard will help you set up ANT.");
    out.info("Coming soon - use 'ant doctor' to check your configuration.");
  });

// =============================================================================
// DIAGNOSTICS
// =============================================================================

const diagnostics = program
  .command("diagnostics")
  .description("Run diagnostics and tests on the ANT system");

diagnostics
  .command("test-all")
  .description("Run all diagnostic tests")
  .option("-g, --gateway <url>", "Gateway URL")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "300000")
  .option("--json", "Output as JSON")
  .option("-s, --suite <name>", "Run specific test suite (endpoints, agent, whatsapp)")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => testAll(cfg, options));
  });

diagnostics
  .command("endpoints")
  .description("Test HTTP endpoints")
  .option("-g, --gateway <url>", "Gateway URL")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "300000")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => endpoints(cfg, options));
  });

diagnostics
  .command("agent-health")
  .description("Test agent startup and health")
  .option("-g, --gateway <url>", "Gateway URL")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "300000")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => agentHealth(cfg, options));
  });

diagnostics
  .command("whatsapp")
  .description("Test WhatsApp integration")
  .option("-g, --gateway <url>", "Gateway URL")
  .option("-t, --timeout <ms>", "Timeout in milliseconds", "300000")
  .option("--json", "Output as JSON")
  .action(async (options, cmd) => {
    const cfg = await loadConfig(cmd.optsWithGlobals().config);
    await handleError(() => whatsapp(cfg, options));
  });

// =============================================================================
// PARSE AND RUN
// =============================================================================

program.parseAsync(process.argv).catch((err) => {
  out.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

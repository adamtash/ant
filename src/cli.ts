#!/usr/bin/env node
import { Command } from "commander";

import { loadConfig } from "./config.js";
import { runAnt } from "./runtime/run.js";
import { runDebugPrompt, runDebugInbound } from "./runtime/debug.js";
import { showStatus } from "./runtime/status.js";
import { listSessions, showSession, clearSession } from "./runtime/sessions-cli.js";
import { memorySearchCommand, memoryIndexCommand } from "./runtime/memory-cli.js";
import { listSubagents, cleanupSubagents } from "./runtime/subagents-cli.js";
import { runMcpServer } from "./runtime/mcp-cli.js";
import { stopAnt, restartAnt } from "./runtime/control-cli.js";

const program = new Command();

program.name("ant").description("Ant CLI").version("0.0.0");

program
  .command("run")
  .description("Start the WhatsApp listener and agent runtime")
  .option("-c, --config <path>", "Path to ant.config.json")
  .option("--tui", "Show a live TUI with agent/subagent status")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await runAnt(cfg, { tui: Boolean(options.tui) });
  });

program
  .command("status")
  .description("Show runtime status")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await showStatus(cfg);
  });

program
  .command("stop")
  .description("Stop the running ant process (UI + runtime)")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    const ok = await stopAnt(cfg);
    if (!ok) {
      console.error("ant is not running or could not be stopped");
      process.exitCode = 1;
    }
  });

program
  .command("restart")
  .description("Restart the running ant process (UI + runtime)")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    const ok = await restartAnt(cfg);
    if (!ok) {
      console.error("ant could not be restarted");
      process.exitCode = 1;
    }
  });

program
  .command("mcp-server")
  .description("Run ant MCP server over stdio")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await runMcpServer(cfg);
  });

const debug = program.command("debug").description("Debug utilities");
debug
  .command("run")
  .description("Run a one-off agent prompt without WhatsApp")
  .argument("<prompt>", "Prompt text")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (prompt, options) => {
    const cfg = await loadConfig(options.config);
    await runDebugPrompt(cfg, prompt);
  });
debug
  .command("simulate")
  .description("Simulate an inbound WhatsApp message without WhatsApp")
  .argument("<text>", "Message text")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (text, options) => {
    const cfg = await loadConfig(options.config);
    await runDebugInbound(cfg, text);
  });

const sessions = program.command("sessions").description("Session utilities");
sessions
  .command("list")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await listSessions(cfg);
  });
sessions
  .command("show")
  .argument("<sessionKey>", "Session key")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (sessionKey, options) => {
    const cfg = await loadConfig(options.config);
    await showSession(cfg, sessionKey);
  });
sessions
  .command("clear")
  .argument("<sessionKey>", "Session key")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (sessionKey, options) => {
    const cfg = await loadConfig(options.config);
    await clearSession(cfg, sessionKey);
  });

const memory = program.command("memory").description("Memory utilities");
memory
  .command("search")
  .argument("<query>", "Search query")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (query, options) => {
    const cfg = await loadConfig(options.config);
    await memorySearchCommand(cfg, query);
  });
memory
  .command("index")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await memoryIndexCommand(cfg);
  });

const subagents = program.command("subagents").description("Subagent utilities");
subagents
  .command("list")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await listSubagents(cfg);
  });
subagents
  .command("cleanup")
  .option("-c, --config <path>", "Path to ant.config.json")
  .action(async (options) => {
    const cfg = await loadConfig(options.config);
    await cleanupSubagents(cfg);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

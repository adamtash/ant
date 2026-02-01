/**
 * CLI Module - Exports for the CLI layer
 */

// Core CLI components
export { createProgram, runCli } from "./cli-app.js";
export { OutputFormatter, formatter, print, success, info, warn, error } from "./output-formatter.js";
export {
  CliError,
  ConfigError,
  RuntimeError,
  ConnectionError,
  ValidationError,
  formatError,
  handleError,
  withErrorHandling,
  validateArgs,
  parseJsonArg,
  getErrorHelp,
} from "./error-handler.js";

// Utility commands
export { doctor } from "./doctor.js";
export { onboard } from "./onboard.js";

// Runtime commands
export { start } from "./commands/runtime/start.js";
export { stop } from "./commands/runtime/stop.js";
export { restart } from "./commands/runtime/restart.js";
export { status } from "./commands/runtime/status.js";

// Agent commands
export { ask } from "./commands/agent/ask.js";
export { runTask } from "./commands/agent/run-task.js";
export { listTasks } from "./commands/agent/list-tasks.js";

// Tools commands
export { listTools } from "./commands/tools/list.js";
export { toolDetails } from "./commands/tools/details.js";

// Schedule commands
export { scheduleAdd } from "./commands/schedule/add.js";
export { scheduleList } from "./commands/schedule/list.js";
export { scheduleRun } from "./commands/schedule/run.js";
export { scheduleRemove } from "./commands/schedule/remove.js";

// Memory commands
export { remember } from "./commands/memory/remember.js";
export { recall } from "./commands/memory/recall.js";
export { memoryExport } from "./commands/memory/export.js";

// Monitoring commands
export { logs } from "./commands/monitoring/logs.js";
export { dashboard } from "./commands/monitoring/dashboard.js";

// Sessions commands
export { sessionsList } from "./commands/sessions/list.js";
export { sessionsView } from "./commands/sessions/view.js";
export { sessionsExport } from "./commands/sessions/export.js";
export { sessionsClear } from "./commands/sessions/clear.js";

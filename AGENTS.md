# ant — Agent Instructions

## Identity & Goal
- **Product:** **ant** — local autonomous assistant with WhatsApp integration, tools, memory, and subagents.
- **Core Goals:** single OpenAI-compatible provider (LM Studio), WhatsApp chat, subagents, memory indexing, host-only tool execution (no sandbox for now), TUI.
- **Repo Root:** `/Users/a/Projects/ant-cli`
- **GitHub:** https://github.com/adamtash/ant

## Repository Structure

### Core Source Files
- **CLI Entry:** `src/cli.ts` - command dispatch
- **Gateway Server:** `src/gateway/server.ts` - API & WebSocket server (replaces runtime/ui-server)
- **Agent Engine:** `src/agent/engine.js` - Main agent logic
- **CLI Tools:** `src/cli/commands/` - implementation of CLI commands
- **WhatsApp Client:** `src/channels/whatsapp/client.ts`
- **Memory:** `src/memory/` - SQLite + embeddings

### Configuration & State
- **Config:** `ant.config.json` - runtime configuration (providers, routing, WhatsApp, memory, mainAgent, etc.)
- **Config Schema:** `src/config.ts` - TypeScript types and defaults
- **State Dir:** `.ant/` (sessions, memory, captures, whatsapp auth, subagents registry)
- **Sessions:** `.ant/sessions/*.jsonl` - per-session message logs
- **Memory DB:** `.ant/memory.sqlite` - embeddings index
- **Subagents Registry:** `.ant/subagents.json` - active/completed subagent runs
- **WhatsApp Auth:** `.ant/whatsapp/` - Baileys session state
- **Logs:** `~/.ant/ant.log` (configurable via `logging.filePath`)
- **Agent Duties:** `AGENT_DUTIES.md` - Main Agent responsibilities (workspaceDir)
- **Agent Log:** `AGENT_LOG.md` - Main Agent action log (workspaceDir)

### Documentation
- **PROJECT.md** - comprehensive knowledge base (overview, config, features, usage, architecture, roadmap)
- **AGENTS.md** (this file) - quick reference for agents working on the codebase

## Key Behaviors & Architecture

### Message Flow (Simplified)
1. **WhatsApp** → parse & filter → **Queue** (per-session lane)
2. **Queue** → send typing → **Agent** (check memory commands / direct tools)
3. **Agent** → route to providers → execute tool loop → build response
4. **Runtime** → parse MEDIA: tokens → send text + media → store session

### Media Pipeline
- Tools return `MEDIA:/path` tokens in their response
- `run.ts` parses output via `splitMediaFromOutput()`
- Text and media are sent separately via WhatsApp
- Local paths resolved relative to `workspaceDir`
- HTTP URLs are downloaded to `.ant/outbound/`

### Direct Tool Fast-Paths
- **Purpose**: Skip LLM round-trip for common intents
- **Location**: `src/runtime/agent.ts` → `tryDirectToolHandling()`
- **Current fast-paths**:
  - `"open X"` → `open_app` tool (macOS only)
  - `"restart ant"` → `restart_ant` tool
- **To add more**: Pattern match in `tryDirectToolHandling()` and invoke tool directly

### CLI Provider Support
- **Parent LLM** handles tools (configured via `routing.parentForCli`)
- **CLI provider** receives:
  - System prompt (without tools)
  - Conversation history
  - Tool outputs summary
  - Memory recall summary
- **CLI prompt built in**: `src/runtime/agent.ts` → `buildCliPromptFromTools()`
- **Execution**: `src/runtime/cli-tools.ts` → `runCliProvider()`
- **Default args** (when `args: []` in config):
  - `codex`: `exec --output-last-message {output} --color never -`
  - `kimi`: `--yolo -`
  - `copilot`: `-p {prompt} --silent --no-color --allow-all-tools --yolo --model gpt-4.1`
  - `claude`: `--print --output-format text --permission-mode dontAsk {prompt}`

### Memory System
- **Indexing**: Embeddings + SQLite (`src/memory/manager.ts`)
- **Sources**:
  - `MEMORY.md` / `memory.md` in workspace
  - `memory/*.md` files
  - Session transcripts (`.ant/sessions/*.jsonl`)
- **Force reindex on search**: `memory_search` tool triggers sync before searching
- **Sync policies** (configurable):
  - `onSessionStart` - index when runtime boots
  - `onSearch` - index before each search
  - `watch` - watch files and re-index on changes (debounced)
  - `intervalMinutes` - periodic syncs (0 disables)
- **Memory commands**: `/memory <note>` or `/remember <note>` appends to `MEMORY.md`

### TUI Mode
- **Purpose**: Live dashboard for monitoring (main task, queue, subagents, drone flights)
- **Launch**: `npm run dev -- run -c ant.config.json --tui`
- **Implementation**: `src/runtime/tui.ts` (blessed library)
- **Features**:
  - Status + subagent panels with drone flights (scheduled jobs)
  - Key bindings: `p` pause, `q` quit, `?` help

### Web UI
- **Purpose**: Browser-based dashboard (logs, status, queue, subagents)
- **Launch**: Auto-opens if `ui.autoOpen: true` (default: `http://127.0.0.1:5117`)
- **Implementation**: `src/runtime/ui-server.ts` (Express) + `ui/` (Vite + React)
- **API Routes**:
  - `GET /api/status` - runtime status
  - `GET /api/logs/stream` - SSE log stream
  - `GET /api/queue` - queue snapshot
  - `GET /api/subagents` - subagent list
  - `GET /api/sessions` - session list
  - `POST /api/memory/search` - memory search
- **Build UI**: `npm run ui:build` (output: `ui/dist`)
- **Dev UI**: `npm run ui:dev` (Vite dev server with proxy)

### Provider Routing
- **Actions**: `chat`, `tools`, `embeddings`, `summary`, `subagent`
- **Config**: `routing` section maps actions to provider IDs
- **Resolution**: `src/runtime/providers.ts` → `resolveProvider(action)`
- **Fallback**: If no routing entry, uses `providers.default`
- **Per-action models**: Provider can define `models.chat`, `models.tools`, etc.

### Tool Execution Loop
1. LLM returns tool calls (OpenAI format: `tool_calls` array)
2. For each call, find matching tool by name
3. Execute tool with `args` and `ToolContext`
4. Append tool result to message history (role: `tool`, `tool_call_id`)
5. Send updated history back to LLM
6. Repeat until LLM returns final text (max 6 iterations)

### Subagent Lifecycle
1. **Spawn**: `sessions_spawn` tool creates record, returns immediately
2. **Execute**: Subagent runs in background via `agent.runTask({ isSubagent: true })`
3. **Announce**: Result sent to requester chat via WhatsApp
4. **Archive**: Completed runs archived after `subagents.archiveAfterMinutes`
- **Registry**: `.ant/subagents.json` (persisted on each status change)
- **Session key**: `subagent:<runId>`

### Main Agent System
- **Purpose**: Continuous background supervisor for system health, maintenance, and improvements
- **Inspired by**: Ralph Wiggum loop (iterative self-referential development)
- **Start**: Automatically on runtime boot if `mainAgent.enabled: true`
- **Context Documents**:
  - `AGENT_DUTIES.md` - Defines responsibilities (subagent management, maintenance, monitoring, improvements)
  - `MEMORY.md` - Persistent knowledge base
- **Session key**: `agent:main:system`
- **Loop**: Endless iteration with configurable delay between cycles
- **Safety**: Max iterations per task, max consecutive failures, alert owner on critical issues
- **Completion**: Outputs `<promise>DUTY_CYCLE_COMPLETE</promise>` after each successful cycle
- **Implementation**: `src/runtime/main-agent.ts` (to be created)
- **Log**: All actions logged to `AGENT_LOG.md`

### Drone Flights (Scheduled Maintenance Tasks)
- **Purpose**: Autonomous scheduled maintenance tasks running on cron jobs
- **Concept**: "Drone Flights" are worker bees performing routine maintenance at specific times
- **Implementation**: `src/scheduler/drone-flights.ts` with node-cron integration
- **Documentation**: See [DRONE_FLIGHTS.md](DRONE_FLIGHTS.md) for detailed reference
- **Three Flight Types**:
  - **Light Check** (every 5 min): Quick health checks, error monitoring
  - **Hourly Deep Maintenance** (every hour): Log analysis, auto-fix known issues
  - **Weekly Deep Dive** (every Monday 00:00): Comprehensive review, trend analysis
- **Session keys**: `drone-flight:<flightId>` (separate from main agent)
- **Auto-initialization**: Flights register with scheduler on runtime start
- **Customizable**: Edit cron expressions and timeouts in `src/scheduler/drone-flights.ts`

## Current Status (as of 2026-02-02)

### Implemented Features
- WhatsApp listener (Baileys) with typing indicator
- Tool system: file ops, exec, screenshot, screen_record, browser (Playwright), bird (Twitter/X)
- Subagent orchestration + persistence (registry-based)
- Memory indexing: SQLite + embeddings (MEMORY.md + memory/*.md + sessions)
- Media reply pipeline: `MEDIA:` token parsing and sending
- CLI provider support: Codex/Copilot/Claude/Kimi with parent tool runner
- Live TUI: queue/subagent dashboard with blessed
- Web UI: Express API + Vite React frontend
- Direct tool fast-paths: `open_app`, `restart_ant` (skip LLM)
- MCP support: Copilot/Claude CLIs can call `memory_search` and `memory_get`
- **Main Agent System**: Autonomous supervisor with duty cycles
  - Runs diagnostics, monitors health, manages subagents
  - Task assignment API via `/api/main-agent/tasks`
  - Startup health checks with WhatsApp reporting
- **Drone Flights**: Scheduled maintenance tasks (cron jobs)
  - Light Check, Hourly Deep Maintenance, Weekly Deep Dive
  - Auto-initialization on runtime start
  - Integrated with scheduler system
- Supervisor: Process supervisor for graceful restarts (exit code 42)

### Recently Completed ✅
- **Main Agent System**: Ralph-inspired continuous loop for system supervision
  - Auto-start on boot
  - Persistent duties: subagent management, maintenance, monitoring, improvements
  - Self-referential feedback loop
  - Safety mechanisms: iteration limits, failure thresholds, owner alerts
  - Implementation: `src/agent/main-agent.ts`
  - API endpoints: `/api/main-agent/tasks`
- **Drone Flights**: Scheduled maintenance tasks (cron job based)
  - Light Check, Hourly Deep Maintenance, Weekly Deep Dive
  - Auto-initialization on runtime start
  - Integrated with scheduler system
  - Implementation: `src/scheduler/drone-flights.ts` and `src/scheduler/drone-flights-init.ts`
  - Documentation: `DRONE_FLIGHTS.md`

### Known Issues
- **TSX restart failure**: `restart_ant` can fail with "pipe permission denied"
  - **Root cause**: TSX IPC socket permissions in `/var/folders/*/T/tsx-501`
  - **Workaround**: `rm -rf /var/folders/*/T/tsx-501` or switch restart command to `node dist/cli.js`
- **Memory search "No models loaded"**: LM Studio embeddings model not loaded
  - **Fix**: Load an embeddings model or set `memory.enabled: false`
- **Screen capture fails**: macOS Screen Recording permission not granted
  - **Fix**: Grant Terminal (or Node binary) Screen Recording in System Settings

## Operational Notes

### Running & Testing
- **Dev mode**: `npm run dev -- run -c ant.config.json`
- **With TUI**: `npm run dev -- run -c ant.config.json --tui`
- **Debug (no WhatsApp)**: `npm run dev -- debug run "test prompt"`
- **Simulate inbound**: `npm run dev -- debug simulate "/memory test note"`
- **Build**: `npm run build` (output: `dist/`)
- **Run built**: `node dist/cli.js run -c ant.config.json`

### CLI Commands
```bash
# Runtime control
npm run dev -- run -c ant.config.json        # Start runtime
ant stop                                      # Stop running instance (WIP)
ant restart                                   # Restart via configured command

# Memory management
npm run dev -- remember "note" -c ant.config.json
npm run dev -- recall "query" -c ant.config.json

# Session management
npm run dev -- sessions list -c ant.config.json
npm run dev -- sessions show "whatsapp:dm:<jid>" -c ant.config.json
npm run dev -- sessions clear "whatsapp:dm:<jid>" -c ant.config.json

# Subagent management
npm run dev -- subagents list -c ant.config.json
npm run dev -- subagents show <runId> -c ant.config.json

# Debug tools
npm run dev -- debug run "test prompt"       # Agent only (no WhatsApp)
npm run dev -- debug simulate "message"      # Full inbound flow (no WhatsApp)
```

### Logging
- **File**: `~/.ant/ant.log` (default; configurable via `logging.filePath`)
- **Levels**: `trace`, `debug`, `info`, `warn`, `error`
- **Config**:
  ```json
  "logging": {
    "level": "info",        // console level (or TUI suppresses console)
    "fileLevel": "trace"    // file level (independent of console)
  }
  ```
- **Structured logs**: JSON format via pino
- **Watch logs**: `tail -f ~/.ant/ant.log`

### Paths & State
- **Working dir**: Configurable via `workspaceDir` (default: repo root)
- **State dir**: `.ant/` (relative to config file location)
- **Sessions**: `.ant/sessions/<sessionKey>.jsonl`
- **Memory**: `.ant/memory.sqlite`
- **Subagents**: `.ant/subagents.json`
- **WhatsApp auth**: `.ant/whatsapp/` (Baileys state)
- **Captures**: `.ant/captures/` (screenshots, recordings)
- **Outbound media**: `.ant/outbound/` (downloaded HTTP media)

### Configuration Tips
- **Workspace scope**: Set `workspaceDir: "~"` for home-wide access, or `"/"` for full disk
- **Self-DM only**: `whatsapp.respondToSelfOnly: true` restricts to your own chat
- **Allow self messages**: `whatsapp.allowSelfMessages: true` lets ant respond to your messages
- **Owner allowlist**: `whatsapp.ownerJids: ["123@s.whatsapp.net"]` restricts access
- **Startup message**: `whatsapp.startupMessage` sends a message when runtime boots
- **Memory sync**: Tune `memory.sync.sessionsDeltaMessages` and `sessionsDeltaBytes` to control reindex frequency
- **CLI tool timeout**: `cliTools.timeoutMs` (default: 1200000 ms)
- **Tool policies**: Configure `toolPolicies` and select with `agent.toolPolicy`
- **Compaction**: `agent.compaction` summarizes older context when near the token threshold
- **Thinking level**: `agent.thinking.level` toggles reasoning output

## Tasks & Plan

### Short-term
- [x] Document Main Agent system and Ralph integration
- [x] Implement `src/agent/main-agent.ts`
- [x] Add Main Agent config schema to `src/config.ts`
- [x] Create default `AGENT_DUTIES.md` template
- [x] Integrate Main Agent with gateway server
- [x] Add Main Agent status to Web UI
- [x] Fix Main Agent auto-start on runtime boot
- [x] Implement Drone Flights (scheduled maintenance tasks)
- [x] Create three flight types: Light Check, Hourly, Weekly
- [x] Auto-register flights on runtime startup
- [x] Add Drone Flights status to TUI
- [ ] Add more fast-path intents (screenshot, open browser, list files)
- [ ] Improve retry/backoff for WhatsApp disconnects
- [ ] Improve retry/backoff for provider API errors

### Mid-term
- [ ] Drone Flight analytics and reporting dashboard
- [ ] Custom flight creation via CLI
- [ ] Flight templates (backup, optimization, reporting)
- [ ] Priority-based flight execution
- [ ] Main Agent learning: pattern detection and optimization
- [ ] Main Agent pause/resume commands
- [ ] Add optional media size limits + downscaling for large images
- [ ] Add tool sandboxing option (safe mode for destructive tools)
- [ ] Add reactions/buttons for richer WhatsApp interactions
- [ ] Main Agent custom duties plugin system

### Long-term
- [ ] Multi-Main-Agent orchestration (specialized agents)
- [ ] Extend docs as features stabilize
- [ ] Add multi-channel support (beyond WhatsApp)
- [ ] Add UI for session/memory browsing and management

## Style & Conventions

### Code Style
- **Language**: TypeScript (ESM), strict mode enabled
- **Formatting**: Keep files concise (aim for < 500 LOC when feasible)
- **Comments**: Brief comments only for tricky logic; code should be self-documenting
- **Output**: Default to ASCII in code; Unicode only when necessary
- **Error handling**: Prefer structured error objects: `{ ok: false, error: "message" }`

### Naming Conventions
- **Files**: kebab-case (`agent-runner.ts`, `session-store.ts`)
- **Functions**: camelCase (`resolveProvider`, `buildPrompt`)
- **Types**: PascalCase (`ToolContext`, `SessionMessage`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_MEDIA_BYTES`)
- **Tool names**: snake_case (`memory_search`, `screen_record`)

### Import Patterns
```typescript
// Node built-ins first
import fs from "node:fs/promises";
import path from "node:path";

// External packages
import makeWASocket from "@whiskeysockets/baileys";

// Local imports (relative)
import type { AntConfig } from "../config.js";
import { createLogger } from "../log.js";
```

### Tool Implementation Pattern
```typescript
tools.push({
  name: "my_tool",
  description: "Brief description for LLM.",
  parameters: {
    type: "object",
    properties: {
      arg1: { type: "string", description: "What arg1 does" },
      arg2: { type: "number" }
    },
    required: ["arg1"]
  },
  execute: async (args, ctx) => {
    // 1. Parse and validate
    const parsed = readArgs(args, { arg1: "string" });
    
    // 2. Resolve paths (if needed)
    const filePath = resolvePath(parsed.arg1, ctx.cfg.resolved.workspaceDir);
    
    // 3. Execute logic
    const result = await doWork(filePath);
    
    // 4. Return structured result
    return { content: JSON.stringify({ ok: true, result }) };
  }
});
```

### Logging Pattern
```typescript
// Use structured logging with context
ctx.logger.info({ sessionKey, chatId }, "inbound message");
ctx.logger.debug({ tool: "my_tool", args }, "tool call start");
ctx.logger.warn({ error: err.message }, "operation failed");
ctx.logger.error({ critical: true }, "fatal error");
```

### Error Handling Pattern
```typescript
// In tools: return errors as JSON
try {
  const result = await riskyOperation();
  return { content: JSON.stringify({ ok: true, result }) };
} catch (err) {
  return { 
    content: JSON.stringify({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err) 
    }) 
  };
}

// In runtime: log and re-throw
try {
  await agent.runTask(params);
} catch (err) {
  logger.error({ error: err.message }, "task failed");
  throw err;  // Let caller handle
}
```

### Testing Approach
- **Unit tests**: Not yet comprehensive (TODO)
- **Manual testing**: Use `debug run` and `debug simulate` commands
- **Live testing**: Run with real WhatsApp; test in self-DM mode
- **Tool testing**: Invoke tools via debug prompts: `"Use tool_name with arg=\"value\""`

### Development Workflow
1. **Read context**: Check `AGENTS.md` and `PROJECT.md`
2. **Check TODOs**: Look for `TODO` comments in code
3. **Make changes**: Edit source files
4. **Test locally**: `npm run dev -- debug run "test prompt"`
5. **Test with WhatsApp**: `npm run dev -- run -c ant.config.json`
6. **Check logs**: `tail -f ~/.ant/ant.log`
7. **Update docs**: If adding features, update `PROJECT.md` and `AGENTS.md`

### Common Patterns

#### Path Resolution
```typescript
// Always resolve paths relative to workspaceDir
const filePath = resolvePath(userPath, cfg.resolved.workspaceDir);
```

#### Media Token Return
```typescript
// Return MEDIA: token instead of JSON for media tools
return { content: `MEDIA:${filePath}` };
```

#### Session Context
```typescript
// Store session metadata for cross-session operations
sessions.setSessionContext(sessionKey, {
  sessionKey,
  lastChannel: "whatsapp",
  lastChatId: chatId
});
```

#### Subagent Spawning
```typescript
// Spawn subagents with requester context for announcements
await subagents.spawn({
  task: "research topic X",
  label: "Research",
  requester: { sessionKey, chatId }
});
```

---

**Quick Reference:**
- Full details: see [`PROJECT.md`](PROJECT.md)
- Config schema: see [`src/config.ts`](src/config.ts)
- Tool examples: see [`src/runtime/tools.ts`](src/runtime/tools.ts)
- Test with: `npm run dev -- debug run "test prompt"`

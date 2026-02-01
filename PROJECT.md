# Ant CLI - Project Documentation

## Overview (README)

# ant

A lightweight, autonomous assistant that runs on your own machine and talks to you over WhatsApp. ant can use local tools, manage subagents, and keep memory from past sessions.

### Highlights
- WhatsApp-first agent (Baileys-based) with typing indicators and media replies.
- Local tool execution (files, commands, screenshots, browser automation).
- Subagents for parallel work.
- Memory indexing with embeddings (SQLite + optional session transcript indexing).
- Pluggable providers (OpenAI-compatible, CLI providers like Codex/Copilot/Claude).
- Optional live TUI to visualize main/subagent activity.

### Requirements
- Node.js 22+
- WhatsApp account for QR pairing
- LM Studio (or any OpenAI-compatible API)

### Quick start

1) Install dependencies:
```bash
npm install
```

2) Configure ant:
```json
{
  "workspaceDir": "~",
  "providers": {
    "default": "lmstudio",
    "items": {
      "lmstudio": {
        "type": "openai",
        "baseUrl": "http://localhost:1234/v1",
        "apiKey": "",
        "model": "zai-org/glm-4.7-flash",
        "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
      },
      "codex-cli": {
        "type": "cli",
        "cliProvider": "codex",
        "model": "gpt-5.2-codex",
        "args": ["exec", "--output-last-message", "{output}", "--color", "never", "--skip-git-repo-check", "-"]
      }
    }
  },
  "routing": {
    "chat": "codex-cli",
    "tools": "codex-cli",
    "embeddings": "lmstudio",
    "parentForCli": "lmstudio"
  },
  "whatsapp": {
    "sessionDir": "./.ant/whatsapp",
    "respondToGroups": false,
    "mentionOnly": true,
    "botName": "ant",
    "respondToSelfOnly": true,
    "allowSelfMessages": true,
    "resetOnLogout": true,
    "typingIndicator": true,
    "mentionKeywords": ["ant"],
    "ownerJids": []
  },
  "memory": {
    "enabled": true,
    "indexSessions": true,
    "sqlitePath": "./.ant/memory.sqlite",
    "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
  },
  "agent": { "systemPrompt": "" },
  "subagents": { "enabled": true },
  "logging": { "level": "debug", "fileLevel": "trace" },
  "runtime": {
    "restart": {
      "command": "npm",
      "args": ["run", "dev", "--", "run", "-c", "ant.config.json"]
    }
  }
}
```
Save it as `ant.config.json` in the repo root.

3) Run:
```bash
npm run dev -- run -c ant.config.json
```

4) Pair WhatsApp by scanning the QR in your terminal.

### Web UI
ant serves an embedded web UI on the same UI server (default: `http://127.0.0.1:5117`). API routes are namespaced under `/api/*`.

Config options:
```json
"ui": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 5117,
  "autoOpen": true,
  "openUrl": "http://127.0.0.1:5117",
  "staticDir": "ui/dist"
}
```

Build the UI (production):
```bash
npm run ui:build
```

Run the UI in dev mode (Vite at 5117, proxies `/api` to 5117):
```bash
npm run ui:dev
```

When running the runtime, open:
- `http://127.0.0.1:5117` for the embedded UI
- `http://127.0.0.1:5117/api/status` for raw API access

Logs SSE stream now lives at `/api/logs/stream`.

### TUI mode (optional)
The TUI shows a two-column live dashboard with log tail and key hints (`p` pause, `q` quit, `?` help).

```bash
npm run dev -- run -c ant.config.json --tui
```

Logs still go to `~/.ant/ant.log`.

### Tools (built-in)
- File: `read`, `write`, `ls`
- Commands: `exec`, `open_app`, `restart_ant`
- Media: `screenshot`, `screen_record`, `send_file`
- Browser: `browser` (Playwright)
- Memory: `memory_search`, `memory_get`
- Subagents: `sessions_spawn`, `sessions_send`
- Messaging: `message_send`
- External CLI: `external_cli` (Codex/Copilot/Claude) when enabled
- Twitter/X: `bird` (requires bird CLI)

### Browser tool (CDP + proxy)
The browser tool can:
- Control a local Playwright profile (default).
- Attach to an existing Chrome session via CDP (profile `chrome`).
- Route actions to a remote browser control server (target `node`).

Add config:
```json
"browser": {
  "enabled": true,
  "headless": true,
  "defaultProfile": "default",
  "profiles": {
    "chrome": { "cdpUrl": "http://127.0.0.1:9222" }
  },
  "proxyBaseUrl": "http://your-node-browser-host:PORT"
}
```

To attach to your running Chrome:
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
```

### macOS permissions
For screenshots and automation, grant Terminal (or your Node binary) Screen Recording + Accessibility.
Use the tool:
```
macos_permissions
```

### Restarting ant
Say "restart ant" and the `restart_ant` tool will run the configured command and exit the current process.

You can also use the CLI:
```bash
ant stop
ant restart
```

### Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

### WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

---

## Configuration

`ant.config.json` is JSON only.

```json
{
  "workspaceDir": "~",
  "providers": {
    "default": "lmstudio",
    "items": {
      "lmstudio": {
        "type": "openai",
        "baseUrl": "http://localhost:1234/v1",
        "model": "zai-org/glm-4.7-flash",
        "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
      },
      "codex-cli": {
        "type": "cli",
        "cliProvider": "codex",
        "model": "codex"
      }
    }
  },
  "routing": {
    "chat": "codex-cli",
    "tools": "lmstudio",
    "embeddings": "lmstudio",
    "parentForCli": "lmstudio"
  },
  "whatsapp": {
    "sessionDir": "./.ant/whatsapp",
    "respondToGroups": false,
    "mentionOnly": true,
    "respondToSelfOnly": true,
    "mentionKeywords": ["ant"],
    "allowSelfMessages": true,
    "resetOnLogout": true,
    "typingIndicator": true,
    "ownerJids": []
  },
  "memory": {
    "enabled": true,
    "indexSessions": true,
    "sqlitePath": "./.ant/memory.sqlite",
    "embeddingsModel": "text-embedding-nomic-embed-text-v1.5",
    "sync": {
      "onSessionStart": true,
      "onSearch": true,
      "watch": true,
      "watchDebounceMs": 1500,
      "intervalMinutes": 0,
      "sessionsDeltaBytes": 100000,
      "sessionsDeltaMessages": 50
    }
  },
  "agent": {
    "systemPrompt": ""
  },
  "subagents": {
    "enabled": true
  },
  "cliTools": {
    "enabled": true,
    "timeoutMs": 120000,
    "mcp": {
      "enabled": true,
      "tools": ["memory_search", "memory_get"]
    },
    "providers": {
      "codex": { "command": "codex", "args": [] },
      "copilot": { "command": "copilot", "args": [] },
      "claude": { "command": "claude", "args": [] }
    }
  }
}
```

### Notes
- Relative paths are resolved from `workspaceDir`.
- To allow ant to operate across your whole home directory, set `workspaceDir` to `~` (or `/` for full disk).
- `providers.items.*.type` can be `openai` (LM Studio API) or `cli` (Codex/Copilot/Claude CLI).
- `routing` controls which provider handles each action. Use `parentForCli` to select a parent LLM that runs tool calls when `routing.chat` is a CLI provider.
- `respondToSelfOnly` limits WhatsApp replies to messages sent by the connected account.
- When `respondToSelfOnly` is true, ant only replies in the self-chat (your own number), not other chats.
- `ownerJids` can further restrict allowed senders or chats (example: `15551234567@s.whatsapp.net`).
- `typingIndicator` sends WhatsApp "composing" presence updates while replies are generated.
- For screen capture on macOS, grant Screen Recording permission to Terminal (or your Node binary).
- `logging.filePath` defaults to `~/.ant/ant.log`. `logging.fileLevel` controls verbosity for the file output (defaults to `logging.level`).
- `cliTools` uses non-interactive CLI modes by default when `args` is empty.
- You can override CLI `args` and use placeholders `{prompt}` and `{output}` in your custom args.
- `cliTools.mcp` enables MCP for Copilot/Claude CLIs so they can call ant tools.
- `memory.sync` controls when session transcripts are re-indexed:
  - `onSessionStart`: run a sync when the runtime boots.
  - `onSearch`: run a sync before memory searches.
  - `watch`: watch session transcript files and sync after edits.
  - `intervalMinutes`: periodic syncs (0 disables).
  - `sessionsDeltaBytes` / `sessionsDeltaMessages`: minimum changes before indexing.
- Default CLI args (when `args` is empty):
  - codex: `exec --output-last-message {output} --color never -` (prompt via stdin)
  - copilot: `-p {prompt} --silent --no-color --allow-all-tools`
  - claude: `--print --output-format text --permission-mode dontAsk {prompt}`

---

## Features

### WhatsApp
- Web-based integration using Baileys.
- Self-DM support (controlled by `whatsapp.allowSelfMessages`).
- Self-only reply mode with `whatsapp.respondToSelfOnly`.
- Group gating using mentions, bot name, or `mentionKeywords`.
- Typing indicator support (`whatsapp.typingIndicator`).
- OS control tools (read/write/exec/ls) plus screenshot and screen recording capture.
- Twitter/X access via bird CLI.
- Headless browser automation via Playwright.

### Providers + routing
- Multiple providers (OpenAI-compatible APIs and CLI providers).
- Route chat, tools, embeddings, summaries, and subagents per action.
- CLI providers run single-turn responses; tool calls are handled by a parent LLM.

### Subagents
- Spawn parallel runs using `sessions_spawn` tool.
- Results are announced back to the requester chat.
- Registry stored under `.ant/subagents.json`.

### Memory
- Embeddings + sqlite index for MEMORY.md + memory/*.md.
- Session transcripts indexed by default.
- Configurable transcript sync policies (startup, search, watch, interval).
- Tools: `memory_search` and `memory_get`.

### Debugging
- `ant debug run` for prompt-only runs.
- `ant debug simulate` for full inbound flow without WhatsApp.

### External CLI tools
- `external_cli` tool routes prompts to Codex, Copilot, or Claude CLIs.
- Uses non-interactive modes and captures final output:
  - Codex: `codex exec --output-last-message`
  - Copilot: `copilot -p --silent`
  - Claude: `claude --print --output-format text`

---

## Memory System

- Ant indexes:
  - `MEMORY.md` / `memory.md`
  - `memory/*.md`
  - session transcripts (`.ant/sessions/*.jsonl`)

- Use `/memory <note>` or `/remember <note>` in chat to append to memory.

- `memory_search` forces session transcript reindexing on search.

---

## Usage

### Start

```bash
npm install
npm run dev -- run -c ant.config.json
```

You should see a QR code in the terminal. Scan it with WhatsApp.

If you want Codex/Copilot/Claude as the main model, keep an OpenAI provider for tools and set routing:

```json
"providers": {
  "default": "lmstudio",
  "items": {
    "lmstudio": { "type": "openai", "baseUrl": "http://localhost:1234/v1", "model": "zai-org/glm-4.7-flash" },
    "codex-cli": { "type": "cli", "cliProvider": "codex", "model": "codex" }
  }
},
"routing": {
  "chat": "codex-cli",
  "tools": "lmstudio",
  "embeddings": "lmstudio",
  "parentForCli": "lmstudio"
}
```

To reply only to messages sent by your own account, set:
```json
"whatsapp": { "respondToSelfOnly": true }
```

### Keep it running

Foreground:
```bash
npm run dev -- run -c ant.config.json
```

Background:
```bash
nohup npm run dev -- run -c ant.config.json > ant.log 2>&1 &
tail -f ant.log
```

### Debug without WhatsApp

```bash
npm run dev -- debug run "Reply in 8 words."
npm run dev -- debug simulate "/memory My favorite snack is pistachios"
```

### External CLI tools

Use the `external_cli` tool from the agent to delegate a prompt to Codex/Copilot/Claude CLIs.
If you enable `cliTools.mcp`, Copilot and Claude CLIs can call `memory_search` and `memory_get` via MCP.

Example prompt:
```
Use external_cli with provider "codex" and prompt "Summarize this repo in 5 bullets".
```

### OS control + screen capture

Example prompts:
```
Use exec to run "ls -la ~"
Use read to open ~/Desktop/notes.txt
Use screenshot and send it
Use screen_record for 10 seconds and send it
Use browser with action "extract" and url "https://example.com"
Use browser with action "screenshot" and url "https://example.com" and send true
```

On macOS, enable Screen Recording for Terminal in:
System Settings → Privacy & Security → Screen Recording.
You can also use the `macos_permissions` tool to open the settings panes.

### Twitter/X via bird

Install bird (if missing):
```bash
brew install steipete/tap/bird
# or
npm install -g @steipete/bird
```

Then run:
```
bird check
bird whoami
```

Example prompt:
```
Use bird with args ["search", "from:jack", "-n", "5"]
```

### Memory Commands

Create a note from chat:
```
/memory My favorite snack is pistachios
```

Index + search:
```bash
npm run dev -- memory index -c ant.config.json
npm run dev -- memory search "favorite snack" -c ant.config.json
```

### Sessions

```bash
npm run dev -- sessions list -c ant.config.json
npm run dev -- sessions show "whatsapp:dm:<chat-id>" -c ant.config.json
npm run dev -- sessions clear "whatsapp:dm:<chat-id>" -c ant.config.json
```

---

## Main Agent System

### Overview

ant includes a **Main Agent** that runs continuously in the background, acting as a supervisor and autonomous worker. Unlike reactive message handlers, the Main Agent proactively monitors the system, manages subagents, performs maintenance, and works on improvements.

### Concept

The Main Agent is inspired by the **Ralph Wiggum loop technique**—a continuous iterative process where an AI agent:
1. Reviews its duties and current state
2. Identifies and prioritizes tasks
3. Executes work incrementally
4. Checks progress and completion criteria
5. Repeats indefinitely

This creates a self-referential feedback loop where the agent:
- Sees its previous work in files and session history
- Learns from past iterations
- Autonomously improves the system over time
- Never needs external prompting to continue

### Core Documents

The Main Agent operates with two key context documents:

#### 1. Agent Duties (`AGENT_DUTIES.md`)

Defines the agent's responsibilities and operational guidelines:

```markdown
# Main Agent Duties

## Primary Responsibilities

### 1. Subagent Management
- Monitor active subagents via `.ant/subagents.json`
- Check for stuck or long-running tasks (> 10 minutes)
- Cancel or restart failed subagents
- Ensure subagent results are delivered to requesters
- Archive completed subagents older than configured threshold

### 2. System Maintenance
- Monitor queue health (check for stuck sessions)
- Clean up old session logs (> 30 days)
- Prune large session files (> 10 MB)
- Verify provider connectivity (test embeddings, chat)
- Check disk space in `.ant/` directory
- Validate memory index integrity

### 3. Memory Management
- Index new content when threshold is met
- Merge duplicate memory entries
- Archive old session transcripts to memory
- Summarize long conversations for memory
- Detect and fix broken memory links

### 4. Improvements & Optimization
- Analyze tool usage patterns
- Suggest new tools based on common requests
- Identify repetitive tasks for automation
- Optimize slow operations (log analysis)
- Update documentation when behavior changes

### 5. Monitoring & Alerts
- Track error rates (log analysis)
- Monitor API usage and costs
- Detect unusual activity patterns
- Alert owner on critical issues via WhatsApp
- Log significant events to `AGENT_LOG.md`

## Completion Criteria

After each iteration, check:
- [ ] All subagents healthy or archived
- [ ] No critical errors in last 100 log lines
- [ ] Memory index up to date
- [ ] Disk usage < 80%
- [ ] All duties checked

If all checks pass: wait 5 minutes, then repeat.
If issues found: address them, log actions, then continue.

## Self-Correction

1. **Before each action**: Check if it's safe and necessary
2. **After each action**: Verify success, log outcome
3. **On failure**: Document what went wrong, try alternative approach
4. **On uncertainty**: Consult memory or ask owner via WhatsApp

## Iteration Limits

- **Per task**: Maximum 10 iterations
- **Global**: No limit (continuous operation)
- **Failures**: After 3 consecutive failures, alert owner and pause

## Output Protocol

Log all actions to `AGENT_LOG.md`:
```
[2026-02-01 13:30] ITERATION_START: Checking system health
[2026-02-01 13:31] SUBAGENTS: 2 active, 1 archived
[2026-02-01 13:32] MEMORY: 45 entries, last indexed 2h ago
[2026-02-01 13:33] DISK: 234 MB used (12%)
[2026-02-01 13:34] ITERATION_END: All healthy, sleeping 5min
```

Output `<promise>DUTY_CYCLE_COMPLETE</promise>` at end of each successful iteration.
```

#### 2. Memory Context (`MEMORY.md`)

The agent's persistent knowledge base (already exists in ant):
- User preferences and behaviors
- System configuration history
- Common issues and solutions
- Project-specific knowledge
- Optimization learnings

### Configuration

Enable the Main Agent in `ant.config.json`:

```json
{
  "mainAgent": {
    "enabled": true,
    "iterationDelayMinutes": 5,
    "maxIterationsPerTask": 10,
    "maxConsecutiveFailures": 3,
    "dutiesFile": "AGENT_DUTIES.md",
    "logFile": "AGENT_LOG.md",
    "completionPromise": "<promise>DUTY_CYCLE_COMPLETE</promise>",
    "duties": {
      "subagentManagement": true,
      "systemMaintenance": true,
      "memoryManagement": true,
      "improvements": true,
      "monitoring": true
    },
    "thresholds": {
      "stuckSubagentMinutes": 10,
      "oldSessionDays": 30,
      "largeSessionMB": 10,
      "diskUsagePercent": 80,
      "memoryIndexDeltaMinutes": 120
    },
    "alertOwnerOnCritical": true
  }
}
```

### Implementation

The Main Agent runs as a persistent background task:

```typescript
// src/runtime/main-agent.ts

export async function startMainAgent(params: {
  cfg: AntConfig;
  logger: Logger;
  agent: AgentRunner;
  sessions: SessionStore;
  subagents: SubagentManager;
  memory: MemoryManager;
  sendMessage: (chatId: string, text: string) => Promise<void>;
}): Promise<void> {
  if (!params.cfg.mainAgent?.enabled) {
    params.logger.info("main agent disabled");
    return;
  }

  const sessionKey = "main-agent:system";
  const config = params.cfg.mainAgent;
  let consecutiveFailures = 0;

  // Load duties document
  const dutiesPath = path.join(
    params.cfg.resolved.workspaceDir,
    config.dutiesFile || "AGENT_DUTIES.md"
  );
  const duties = await fs.readFile(dutiesPath, "utf-8").catch(() => "");

  // Build persistent prompt
  const systemPrompt = `You are the Main Agent for ant, a self-managing autonomous assistant.

Your duties are defined in the following document. Read it carefully and execute your responsibilities in order.

${duties}

After completing each duty cycle, output: ${config.completionPromise}

You have access to all tools. Use them to inspect system state, perform maintenance, and make improvements.

IMPORTANT:
- Work incrementally. One task at a time.
- Always verify before destructive operations.
- Log your actions to ${config.logFile}.
- If uncertain, ask the owner via message_send.
- After ${config.maxIterationsPerTask} iterations on one task, move to the next duty.
`;

  params.logger.info("main agent starting");

  // Endless loop
  while (true) {
    try {
      // Build prompt for this iteration
      const prompt = `Begin duty cycle iteration.

Check all duties in order:
1. Subagent Management
2. System Maintenance  
3. Memory Management
4. Improvements & Optimization
5. Monitoring & Alerts

For each duty, inspect current state and take necessary actions.
Log your findings and actions.
Output completion promise when all duties checked.`;

      // Run agent task
      const result = await params.agent.runTask({
        sessionKey,
        task: prompt,
        isSubagent: false,
      });

      // Check for completion promise
      if (result.includes(config.completionPromise || "DUTY_CYCLE_COMPLETE")) {
        params.logger.info("main agent duty cycle complete");
        consecutiveFailures = 0;
      } else {
        params.logger.warn("main agent cycle incomplete");
        consecutiveFailures++;
      }

      // Check failure threshold
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        const ownerJid = params.cfg.whatsapp.ownerJids?.[0];
        if (config.alertOwnerOnCritical && ownerJid) {
          await params.sendMessage(
            ownerJid,
            `⚠️ Main Agent: ${consecutiveFailures} consecutive failures. Pausing for review.`
          );
        }
        params.logger.error("main agent paused due to failures");
        break;
      }

      // Wait before next iteration
      const delayMs = (config.iterationDelayMinutes || 5) * 60_000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      params.logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "main agent iteration failed"
      );
      consecutiveFailures++;

      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        break;
      }

      // Shorter delay on error
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
  }
}
```

### Integration with Runtime

Add to `src/runtime/run.ts`:

```typescript
import { startMainAgent } from "./main-agent.js";

// After agent initialization
void startMainAgent({
  cfg,
  logger,
  agent: agent!,
  sessions,
  subagents,
  memory,
  sendMessage,
});
```

### Ralph-Inspired Workflow

The Main Agent implements the Ralph loop philosophy:

1. **Iteration > Perfection**: Small incremental improvements over time
2. **Failures Are Data**: Log failures, learn patterns, adjust approach
3. **Persistence Wins**: Continuous operation until system is optimal
4. **Self-Referential**: Agent sees its own past work and builds on it

### Best Practices

#### Writing Agent Duties

✅ **Good:**
```markdown
## Check Subagents
1. Read `.ant/subagents.json`
2. For each active subagent:
   - Check if `startedAt` is > 10 minutes ago
   - If stuck, log warning and mark as error
3. Archive completed runs older than threshold
4. Output: "Subagents healthy: X active, Y archived"
```

❌ **Bad:**
```markdown
## Subagents
Make sure they're working.
```

#### Completion Criteria

- Always include a clear completion promise in duties
- Use exact string matching (e.g., `<promise>DUTY_CYCLE_COMPLETE</promise>`)
- Include fallback criteria (max iterations, time limits)
- Define what "healthy" means for each duty

#### Safety Mechanisms

- **Max iterations per task**: Prevents infinite loops on single duty
- **Max consecutive failures**: Pauses agent after repeated errors
- **Alert on critical**: Notifies owner via WhatsApp when paused
- **Log all actions**: Full audit trail in `AGENT_LOG.md`

### Monitoring

Check Main Agent status:

```bash
# View agent log
tail -f AGENT_LOG.md

# Check agent session
npm run dev -- sessions show "main-agent:system" -c ant.config.json

# Monitor in TUI
npm run dev -- run -c ant.config.json --tui
```

### When to Use Main Agent

✅ **Good for:**
- Routine maintenance tasks
- System health monitoring
- Subagent supervision
- Incremental improvements
- Background optimization

❌ **Not good for:**
- User-facing interactions (use WhatsApp handler)
- Real-time responses (use direct tools)
- Creative/design decisions (requires human judgment)
- Critical operations (needs human approval)

---

## Architecture & Development

### System Architecture

ant follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                        WhatsApp Layer                        │
│  (Baileys client, message parsing, media handling)          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                       Queue Layer                            │
│  (CommandQueue - per-session lanes, concurrency control)    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Runtime Layer                           │
│  (run.ts - orchestration, typing indicators, media replies) │
│  + Main Agent Loop (continuous background supervision)      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                       Agent Layer                            │
│  (AgentRunner - prompt building, tool loop, provider routing)│
└────┬──────────────┬──────────────┬─────────────┬────────────┘
     │              │              │             │
     ▼              ▼              ▼             ▼
┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐
│ Tools   │  │Providers │  │ Memory   │  │ Subagents  │
│         │  │          │  │          │  │            │
└─────────┘  └──────────┘  └──────────┘  └────────────┘
                                │
                                ▼
                          ┌──────────┐
                          │Main Agent│
                          │(Ralph    │
                          │ Loop)    │
                          └──────────┘
```

### Execution Flow

#### 1. Inbound Message Flow

```
WhatsApp Message
  │
  ├─> Parse & Validate (client.ts)
  │    ├─ Check self-DM mode
  │    ├─ Check group mentions
  │    └─ Check owner allowlist
  │
  ├─> Queue by Session (queue.ts)
  │    └─ Per-session lane ensures serial processing
  │
  ├─> Send Typing Indicator (run.ts)
  │
  ├─> Check Memory Command (agent.ts)
  │    └─ If /memory or /remember, append to MEMORY.md
  │
  ├─> Check Direct Tool (agent.ts)
  │    ├─ "open X" → open_app
  │    └─ "restart ant" → restart_ant
  │
  ├─> Route to Provider (agent.ts)
  │    ├─ OpenAI provider: tool loop with LLM
  │    ├─ CLI provider: parent LLM for tools, CLI for final response
  │    └─ Mixed: parent LLM for tools, chat provider for final
  │
  ├─> Execute Tools (tools.ts)
  │    └─ Collect outputs, handle MEDIA: tokens
  │
  ├─> Build Final Response (agent.ts)
  │    ├─ Strip <think> tags
  │    └─ Append tool media tokens
  │
  ├─> Parse Media Tokens (run.ts)
  │    └─ Split text and MEDIA: paths
  │
  ├─> Send Reply (run.ts)
  │    ├─ Send text message
  │    └─ Send media attachments
  │
  └─> Store Session (session-store.ts)
       └─ Append user + assistant messages to .jsonl
```

#### 2. Tool Execution Flow

```
Tool Call Request
  │
  ├─> Parse Arguments (agent.ts)
  │    └─ JSON.parse tool call function.arguments
  │
  ├─> Find Tool Definition (tools.ts)
  │    └─ Match by tool.name
  │
  ├─> Execute Tool (tools.ts)
  │    ├─ Validate parameters
  │    ├─ Resolve paths (relative to workspaceDir)
  │    └─ Run tool logic
  │
  └─> Return Result (tools.ts)
       ├─ JSON string with { ok, ... }
       └─ Or MEDIA:/path token for media tools
```

#### 3. Provider Routing

```
Chat Request
  │
  ├─> Resolve Provider (providers.ts)
  │    └─ Check routing config for action (chat/tools/embeddings/etc)
  │
  ├─> Build Messages (agent.ts)
  │    ├─ System prompt (with tools, bootstrap files, runtime info)
  │    ├─ Session history
  │    └─ Current user message
  │
  ├─> Trim for Context (agent.ts)
  │    └─ Keep recent messages within maxHistoryTokens
  │
  ├─> Execute Provider (agent.ts)
  │    ├─ OpenAI: direct API call via openai.ts
  │    └─ CLI: invoke via cli-tools.ts (codex/copilot/claude)
  │
  └─> Return Response
```

### Component Details

#### CommandQueue (`src/runtime/queue.ts`)

- **Purpose**: Serialize requests per session to avoid race conditions
- **Key Features**:
  - Per-lane (session) queueing
  - Configurable concurrency per lane
  - Wait time tracking and warnings
  - Active task tracking
- **API**:
  - `enqueue(lane, task, meta)` - add task to lane queue
  - `setConcurrency(lane, maxConcurrent)` - adjust lane concurrency
  - `snapshot()` - get queue status for all lanes

#### SessionStore (`src/runtime/session-store.ts`)

- **Purpose**: Persist conversation history per session
- **Format**: JSONL (one message per line)
- **Message Schema**:
  ```typescript
  {
    role: "system" | "user" | "assistant" | "tool",
    content: string,
    ts: number,
    toolCallId?: string,  // for tool results
    name?: string         // for tool results
  }
  ```
- **API**:
  - `appendMessage(sessionKey, message)` - append to session log
  - `readMessages(sessionKey, limit?)` - read session history
  - `setSessionContext(sessionKey, context)` - track session metadata
  - `getSessionContext(sessionKey)` - retrieve session metadata

#### SubagentManager (`src/runtime/subagents.ts`)

- **Purpose**: Spawn and track parallel agent tasks
- **Registry**: JSON file at `.ant/subagents.json`
- **Lifecycle**:
  1. `spawn()` creates a record and starts task asynchronously
  2. Task runs via `agent.runTask()` with `isSubagent: true`
  3. Result is announced to requester chat
  4. Completed runs are archived after `archiveAfterMinutes`
- **API**:
  - `spawn({ task, label, requester })` - start subagent
  - `list()` - get all subagent records
  - `cleanup()` - archive old completed runs

#### MemoryManager (`src/memory/manager.ts`)

- **Purpose**: Semantic search over MEMORY.md, memory/*.md, and session transcripts
- **Index**: SQLite database with embeddings
- **Sync Policies** (configurable in `memory.sync`):
  - `onSessionStart` - index on runtime boot
  - `onSearch` - index before each search
  - `watch` - watch files and re-index on changes
  - `intervalMinutes` - periodic indexing
- **API**:
  - `search(query, maxResults?, minScore?)` - semantic search
  - `readFile({ relPath, from?, lines? })` - read memory file snippet
  - `indexAll()` - force full re-index

#### ProviderClients (`src/runtime/providers.ts`)

- **Purpose**: Resolve and manage LLM provider connections
- **Routing**: Maps actions (chat/tools/embeddings/summary/subagent) to provider IDs
- **Provider Types**:
  - `openai`: OpenAI-compatible API (LM Studio, vLLM, etc.)
  - `cli`: External CLI tool (Codex, Copilot, Claude)
- **API**:
  - `resolveProvider(action)` - get provider for action
  - `getOpenAiClient(providerId)` - get OpenAI client instance
  - `getEmbeddingProvider()` - get provider + client for embeddings

### Tool System Internals

#### Tool Definition Schema

```typescript
{
  name: string,              // unique tool name (snake_case)
  description: string,       // what the tool does (shown to LLM)
  parameters: {              // JSON schema for arguments
    type: "object",
    properties: { ... },
    required: [ ... ]
  },
  execute: async (args, ctx) => Promise<{ content: string }>
}
```

#### Tool Context

Every tool receives a `ToolContext` object:

```typescript
{
  cfg: AntConfig,           // full runtime config
  logger: Logger,           // structured logger
  memory: MemoryManager,    // memory search/read
  sessions: SessionStore,   // session history
  subagents: SubagentManager, // subagent spawning
  sendMessage: (chatId, text) => Promise<void>,
  sendMedia: (chatId, payload) => Promise<void>,
  requester?: {             // originating session (for subagents)
    sessionKey: string,
    chatId: string
  }
}
```

#### Tool Return Patterns

1. **JSON Result**:
   ```typescript
   return { content: JSON.stringify({ ok: true, data: ... }) }
   ```

2. **Media Token** (image/video/document):
   ```typescript
   return { content: `MEDIA:/path/to/file.png` }
   ```

3. **Error Result**:
   ```typescript
   return { content: JSON.stringify({ ok: false, error: "reason" }) }
   ```

#### Adding a New Tool

1. **Define tool in `src/runtime/tools.ts`**:
   ```typescript
   tools.push({
     name: "my_tool",
     description: "What this tool does",
     parameters: {
       type: "object",
       properties: {
         arg1: { type: "string" },
         arg2: { type: "number" }
       },
       required: ["arg1"]
     },
     execute: async (args, ctx) => {
       const parsed = readArgs(args, { arg1: "string" });
       // tool logic here
       return { content: JSON.stringify({ ok: true, result: ... }) };
     }
   });
   ```

2. **Test the tool**:
   ```bash
   npm run dev -- debug run "Use my_tool with arg1=\"test\""
   ```

3. **Document in PROJECT.md** (update tools list).

### Data Structures

#### Session File Format (`.ant/sessions/*.jsonl`)

```jsonl
{"role":"user","content":"hello","ts":1738454400000}
{"role":"assistant","content":"Hi! How can I help?","ts":1738454401000}
{"role":"user","content":"list files","ts":1738454410000}
{"role":"assistant","content":"","tool_calls":[{"id":"call_123","function":{"name":"ls","arguments":"{}"}}],"ts":1738454411000}
{"role":"tool","tool_call_id":"call_123","content":"{\"entries\":[...]}","ts":1738454412000}
{"role":"assistant","content":"Here are the files: ...","ts":1738454413000}
```

#### Memory Index Schema (SQLite)

```sql
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB NOT NULL
);
```

#### Subagent Registry Format (`.ant/subagents.json`)

```json
[
  {
    "runId": "uuid",
    "childSessionKey": "subagent:uuid",
    "requesterSessionKey": "whatsapp:dm:...",
    "requesterChatId": "...",
    "task": "research topic X",
    "label": "Research",
    "createdAt": 1738454400000,
    "startedAt": 1738454401000,
    "endedAt": 1738454450000,
    "status": "complete",
    "result": "Here are my findings..."
  }
]
```

### Development Workflows

#### Adding a New Provider Type

1. **Update config schema** (`src/config.ts`):
   ```typescript
   type: "openai" | "cli" | "mynewprovider"
   ```

2. **Add provider client** (`src/runtime/providers.ts`):
   ```typescript
   if (provider.type === "mynewprovider") {
     // provider-specific logic
   }
   ```

3. **Handle in agent** (`src/runtime/agent.ts`):
   ```typescript
   if (chatProvider.type === "mynewprovider") {
     const result = await this.runWithMyNewProvider(...);
   }
   ```

#### Modifying Message Handling

- **Inbound parsing**: `src/whatsapp/client.ts` → `toInboundMessage()`
- **Filtering logic**: Check `respondToSelfOnly`, `respondToGroups`, `mentionOnly`, `ownerJids`
- **Queue integration**: `src/runtime/run.ts` → `onMessage` callback

#### Adding a Fast-Path Intent

1. **Update `tryDirectToolHandling()`** in `src/runtime/agent.ts`:
   ```typescript
   if (lower.includes("my keyword")) {
     const tool = params.tools.find(t => t.name === "my_tool");
     if (tool) {
       params.logger.debug("direct tool: my_tool");
       const result = await tool.execute("{}", params.ctx);
       return "Done.";
     }
   }
   ```

2. **Test without round-tripping to model**:
   ```bash
   npm run dev -- debug run "my keyword"
   ```

### Error Handling Patterns

#### Provider Failures

- **OpenAI Client** (`src/runtime/openai.ts`):
  - Network errors: thrown as exceptions
  - API errors: returned in response
  - Retry logic: not implemented (TODO)

- **CLI Providers** (`src/runtime/cli-tools.ts`):
  - Exit code tracking
  - Timeout handling (default: 120s)
  - stderr capture

#### WhatsApp Disconnections

- **Auto-reconnect**: 3s delay after disconnect
- **Reset on logout**: Optional `whatsapp.resetOnLogout`
- **Status tracking**: `whatsappStatus` store for UI

#### Tool Errors

- **Caught in tool loop**: `agent.ts` → `runToolLoop()`
- **Returned as tool result**: `{ error: "message" }`
- **Logged**: `logger.warn({ tool, toolCallId, error })`

#### Common Issues

1. **TSX restart failure**:
   - **Symptom**: `restart_ant` fails with "pipe permission denied"
   - **Fix**: `rm -rf /var/folders/*/T/tsx-501` or switch to `node dist/cli.js`

2. **Memory search "No models loaded"**:
   - **Symptom**: Memory tool returns error
   - **Fix**: Load embeddings model in LM Studio or disable memory in config

3. **Screen capture fails**:
   - **Symptom**: screenshot/screen_record returns permission error
   - **Fix**: Grant Screen Recording permission to Terminal in System Settings

4. **WhatsApp QR not scanning**:
   - **Symptom**: QR shown but pairing fails
   - **Fix**: Delete `.ant/whatsapp` and restart

---

## Roadmap

### Short-term
- Implement Main Agent system with Ralph-inspired loop
- Create default `AGENT_DUTIES.md` template
- Add Main Agent monitoring to TUI and Web UI
- Improve LM Studio retry/backoff handling
- Add basic health checks for WhatsApp connectivity

### Mid-term
- Main Agent learning: track patterns and optimize duties
- Add reactions/buttons for richer WhatsApp interactions
- Add optional local embeddings (node-llama-cpp)
- Tool sandboxing option for Main Agent safety
- Main Agent pause/resume commands

### Long-term
- Multi-channel support
- Multi-Main-Agent orchestration (specialized agents)
- UI for session/memory browsing
- Main Agent plugin system for custom duties

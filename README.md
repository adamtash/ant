# 🐜 ANT CLI

A modular, autonomous AI agent runtime that runs locally on your machine. Connect via WhatsApp, CLI, or Web interface. ANT manages memory, schedules tasks, and continuously improves itself through its Main Agent system.

## ✨ Features

- **Multi-Channel Support** - Interact via WhatsApp, CLI commands, or Web UI (React + Tailwind)
- **Cron Scheduling** - Schedule recurring agent tasks with cron expressions
- **Memory System** - Semantic search with embeddings over notes and session history (SQLite)
- **Main Agent Loop** - Ralph-inspired autonomous system that continuously monitors, maintains, and improves
- **Subagents** - Spawn parallel workers for complex tasks
- **Local Tools** - File operations, shell commands, screenshots, browser automation (Playwright)
- **Pluggable Providers** - OpenAI-compatible APIs (LM Studio) or CLI tools (Codex, Claude, Copilot)
- **Provider Discovery & Survival Mode** - Auto-discover local backups (Ollama/LM Studio) and recover when providers fail
- **Web Dashboard** - Real-time monitoring, session history, memory search, and system health
- **Health + Watchdog** - `/health` liveness, `/ready` dependency readiness, optional watchdog supervisor

## Installation

```bash
# Clone and install
git clone <repo-url>
cd ant-cli
npm install

# Build the project
npm run build

# Build the web UI (production)
npm run ui:build
```

### System Requirements

- **Node.js 22+** - Runtime engine
- **WhatsApp account** - For QR pairing (optional if using CLI/Web only)
- **LM Studio or OpenAI-compatible API** - For local LLM inference
- **macOS/Linux** - Primary support (Windows WSL2 compatible)
- **Screen Recording permission** (macOS) - For screenshot/recording tools

## Quick Start

### 1. Configuration

Copy and customize `ant.config.json` in the project root:

```json
{
  "workspaceDir": "~",
  "providers": {
    "default": "lmstudio",
    "items": {
      "lmstudio": {
        "type": "openai",
        "baseUrl": "http://localhost:1234/v1",
        "model": "your-model-name",
        "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
      }
    }
  },
  "whatsapp": {
    "sessionDir": "./.ant/whatsapp",
    "respondToSelfOnly": true,
    "typingIndicator": true
  },
  "memory": {
    "enabled": true,
    "sqlitePath": "./.ant/memory.sqlite"
  },
  "scheduler": {
    "enabled": true,
    "storePath": "./.ant/jobs.json"
  },
  "ui": {
    "enabled": true,
    "port": 5117,
    "autoOpen": true
  },
  "mainAgent": {
    "enabled": true,
    "intervalMs": 300000
  }
}
```

### 2. Start the Runtime

```bash
# Development mode (with hot reload)
npm run dev -- run -c ant.config.json

# With TUI dashboard (real-time monitoring + drone flights)
npm run dev -- run -c ant.config.json --tui

# Production mode
npm start
```

### 3. Web UI

Open **http://localhost:5117** in your browser to access:
- 🎛️ **Royal Chamber** - Main dashboard with real-time status
- 💬 **Chat Interface** - Direct conversation with the agent
- 📊 **Sessions** - View and export conversation history
- 🧠 **Memory** - Search semantic knowledge base
- ⚙️ **Settings** - Configure runtime options

### 4. WhatsApp (Optional)

Scan the QR code in the terminal to pair with WhatsApp and start chatting!

---

## Provider Discovery (Backups)

Enable automatic backup discovery in `ant.config.json`:

```json
{
  "providers": {
    "discovery": {
      "enabled": true,
      "researchIntervalHours": 24,
      "healthCheckIntervalMinutes": 15,
      "minBackupProviders": 2
    },
    "local": {
      "enabled": true,
      "preferFastModels": true,
      "autoDownloadModels": false,
      "ollama": { "enabled": true, "endpoint": "http://localhost:11434" },
      "lmstudio": { "enabled": true, "endpoint": "http://localhost:1234/v1" }
    }
  }
}
```

Optional env vars for remote backups (only used if set):
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `GROQ_API_KEY`, `GROQ_MODEL`
- `TOGETHER_API_KEY`, `TOGETHER_MODEL`
- `MISTRAL_API_KEY`, `MISTRAL_MODEL`

Discovered providers are stored in `.ant/providers.discovered.json` and merged at runtime (no changes to `ant.config.json`).

## Health Endpoints

- `GET /health` → liveness (fast OK)
- `GET /ready` → readiness (providers + memory + whatsapp)

## Docker (Production)

```bash
docker build -t ant-cli:latest -f Dockerfile.prod .
docker compose up -d
```

## Watchdog (Optional)

```bash
docker build -t ant-watchdog:latest -f Dockerfile.watchdog .
```

## CLI Commands Reference

### Runtime Management

| Command | Description |
|---------|-------------|
| `ant start` | Start the agent runtime |
| `ant start --tui` | Start with TUI dashboard |
| `ant start --detached` | Run in background |
| `ant stop` | Stop the running agent |
| `ant restart` | Restart the agent |
| `ant status` | Show runtime status |

### Agent Interaction

| Command | Description |
|---------|-------------|
| `ant ask "<prompt>"` | Ask a one-off question |
| `ant ask -s <session> "<prompt>"` | Ask in a specific session |
| `ant run-task "<description>"` | Spawn a long-running task |
| `ant run-task -w "<description>"` | Spawn and wait for completion |
| `ant list-tasks` | Show active tasks |
| `ant list-tasks -a` | Show all tasks including completed |

### Scheduling

| Command | Description |
|---------|-------------|
| `ant schedule add "0 9 * * *" -p "<prompt>"` | Schedule daily 9am task |
| `ant schedule list` | List all scheduled jobs |
| `ant schedule run <jobId>` | Manually trigger a job |
| `ant schedule remove <jobId>` | Delete a scheduled job |

### Memory

| Command | Description |
|---------|-------------|
| `ant remember "<note>"` | Add a note to memory |
| `ant recall "<query>"` | Search memory |
| `ant recall -l 10 "<query>"` | Search with limit |
| `ant memory export -f json -o backup.json` | Export memory |

### Sessions

| Command | Description |
|---------|-------------|
| `ant sessions list` | List all sessions |
| `ant sessions view <key>` | View session messages |
| `ant sessions export <key> -f markdown` | Export session |
| `ant sessions clear <key>` | Clear a session |
| `ant sessions clear -a` | Clear all sessions |

### Monitoring

| Command | Description |
|---------|-------------|
| `ant logs` | Tail live logs |
| `ant logs -n 100 -l error` | Last 100 error logs |
| `ant dashboard` | Show TUI dashboard |
| `ant doctor` | Run health checks |
| `ant doctor --fix` | Auto-fix issues |

### Main Agent

| Command | Description |
|---------|-------------|
| `ant main-agent status` | Check Main Agent status |
| `ant main-agent pause` | Pause Main Agent loop |
| `ant main-agent resume` | Resume Main Agent loop |
| `ant main-agent logs` | View Main Agent log file |

### Utilities

| Command | Description |
|---------|-------------|
| `ant list-tools` | Show all available tools |
| `ant tool <name>` | Get tool details and schema |
| `ant onboard` | Interactive setup wizard |
| `ant mcp-server` | Run MCP server over stdio |
| `ant subagents list` | List active subagents |
| `ant subagents cleanup` | Clean up completed subagents |

### Debug

| Command | Description |
|---------|-------------|
| `ant debug run "<prompt>"` | Run prompt without WhatsApp |
| `ant debug simulate "<text>"` | Simulate inbound message |

---

## Programmatic Testing Harness

ANT includes a **programmatic harness** for repeatable “polish loops”: inject a simulated WhatsApp inbound message, observe outbound responses, and capture **full trace logs + session artifacts** in an isolated temp run directory.

### Run a Harness Scenario

```bash
# Inject an inbound WhatsApp message (child-process mode; closest to real CLI runtime)
npm run dev -- diagnostics harness -c ant.config.json --message "Reply with exactly: PONG" --mode child_process --timeout 120000

# Faster, in-process mode (best observability)
npm run dev -- diagnostics harness -c ant.config.json --message "Reply with exactly: PONG" --mode in_process --timeout 120000
```

The command writes a `harness-report.json` and a full `.ant/` state tree (sessions, logs) into a temp directory printed at the end of the run.

Useful flags:
- `--launch-target src|dist` (default: `src`) to run against TypeScript or built output
- `--enable-memory`, `--enable-main-agent`, `--enable-scheduler` to include more subsystems
- `--no-block-exec-deletes` to disable the exec delete guard

### Test-only API Endpoints

When running in test mode (`NODE_ENV=test`) the gateway exposes endpoints used by harnesses:

- `POST /api/test/whatsapp/inbound` — inject an inbound message
- `GET /api/test/whatsapp/outbound` — list outbound messages recorded by the test adapter
- `POST /api/test/whatsapp/outbound/clear` — clear outbound buffer

These endpoints are disabled outside test mode (or can be forced with `ANT_ENABLE_TEST_API=1`).

---

## Configuration (`ant.config.json`)

### Core Settings

```json
{
  "workspaceDir": "~",              // Base directory for file operations
  "logging": {
    "level": "info",                // Console log level
    "fileLevel": "debug"            // File log level (~/.ant/ant.log)
  }
}
```

### Providers

```json
{
  "providers": {
    "default": "lmstudio",
    "items": {
      "lmstudio": {
        "type": "openai",
        "baseUrl": "http://localhost:1234/v1",
        "model": "your-model",
        "embeddingsModel": "text-embedding-nomic-embed-text-v1.5"
      },
      "codex": {
        "type": "cli",
        "cliProvider": "codex"
      }
    }
  },
  "routing": {
    "chat": "codex",            // Provider for chat responses
    "tools": "lmstudio",            // Provider for tool calls
    "embeddings": "lmstudio"        // Provider for memory embeddings
  }
}
```

### Channels

```json
{
  "whatsapp": {
    "sessionDir": "./.ant/whatsapp",
    "respondToSelfOnly": true,      // Only respond to your own messages
    "respondToGroups": false,
    "mentionOnly": true,
    "typingIndicator": true
  },
  "ui": {
    "enabled": true,
    "port": 5117,
    "autoOpen": true
  },
  "gateway": {
    "enabled": true,
    "port": 18789                   // HTTP API for programmatic access
  }
}
```

### Memory

```json
{
  "memory": {
    "enabled": true,
    "sqlitePath": "./.ant/memory.sqlite",
    "indexSessions": true,
    "sync": {
      "onSessionStart": true,
      "onSearch": true,
      "watch": true
    }
  }
}
```

### Scheduler

```json
{
  "scheduler": {
    "enabled": true,
    "storePath": "./.ant/jobs.json",
    "timezone": "UTC"
  }
}
```

### Main Agent (NEW - Autonomous Background System)

```json
{
  "mainAgent": {
    "enabled": true,
    "iterationDelayMinutes": 5,
    "maxIterationsPerTask": 10,
    "maxConsecutiveFailures": 3,
    "dutiesFile": "AGENT_DUTIES.md",
    "logFile": "AGENT_LOG.md",
    "alertOwnerOnCritical": true,
    "duties": {
      "subagentManagement": true,
      "systemMaintenance": true,
      "memoryManagement": true,
      "improvements": true,
      "monitoring": true
    }
  }
}
```

### Monitoring

```json
{
  "monitoring": {
    "enabled": true,
    "retentionDays": 30,
    "alertChannels": ["whatsapp"],
    "criticalErrorThreshold": 5
  }
}
```

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        Channels Layer                           │
│  WhatsApp (Baileys) │ CLI Interface │ Web UI │ HTTP Gateway    │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                      Message Router                             │
│  Routes messages to sessions, manages queue per conversation    │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│                       Agent Runtime                             │
│  Prompt building │ Tool loop │ Provider routing │ Subagents    │
└────┬─────────────┬───────────┬───────────────┬─────────────────┘
     │             │           │               │
     ▼             ▼           ▼               ▼
┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐
│  Tools  │  │Providers│  │ Memory  │  │ Subagents │
│         │  │          │  │         │  │           │
│ • File  │  │ • OpenAI │  │ • SQLite│  │ • Jobs    │
│ • Exec  │  │ • CLI    │  │ • Vector│  │ • Monitors│
│ • Media │  │   tools  │  │ • Search│  │           │
│ • Browse│  │          │  │         │  │           │
└─────────┘  └──────────┘  └─────────┘  └───────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │  Main Agent Loop    │
                    │  (Ralph-Inspired)   │
                    │ • Duty Execution    │
                    │ • System Monitoring │
                    │ • Auto-Improvements │
                    └─────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Channels** | `src/channels/` | WhatsApp, CLI, Web, Gateway adapters |
| **Agent** | `src/agent/` | Core agent logic, prompt building, tool calls |
| **Tools** | `src/tools/` | Built-in tool implementations (40+) |
| **Memory** | `src/memory/` | Embeddings, SQLite store, semantic search |
| **Scheduler** | `src/scheduler/` | Cron job management and execution |
| **Monitor** | `src/monitor/` | Metrics, alerting, event streaming |
| **Gateway** | `src/gateway/` | HTTP API for external integrations |
| **Supervisor** | `src/supervisor.ts` | Main Agent loop, duty execution |
| **CLI** | `src/cli/` | Command-line interface |

### Data Storage

```
.ant/
├── whatsapp/          # WhatsApp session data (Baileys)
├── sessions/          # Conversation history (JSONL)
├── memory.sqlite      # Embeddings & memory index
├── jobs.json          # Scheduled jobs
├── subagents.json     # Active/completed subagents
├── ant.log            # Runtime logs
└── main-agent.log     # Main Agent activity log
```

---

## 🤖 Main Agent System (NEW!)

The **Main Agent** is an autonomous background supervisor that continuously monitors, maintains, and improves the runtime. It's inspired by the **Ralph Wiggum loop** philosophy—a self-referential feedback cycle where the agent reviews its own work and builds upon it.

### Key Features

✅ **Autonomous Operation** - Runs every 5 minutes without user intervention
✅ **Self-Aware** - Reviews its own logs and session history
✅ **Maintenance Focused** - Keeps system healthy and optimized
✅ **Error Recovery** - Detects issues and attempts fixes
✅ **Learning Loop** - Improves strategy based on past iterations
✅ **Owner Alerts** - Notifies you on critical issues via WhatsApp

### How It Works

1. **Iteration Cycle** (Every 5 minutes by default):
   ```
   Read Duties → Inspect State → Execute Tasks → Log Results → Sleep → Repeat
   ```

2. **Core Responsibilities**:
   - 🔧 **Subagent Management** - Monitor, restart, archive parallel tasks
   - 🧹 **System Maintenance** - Cleanup old logs, check health, prune large files
   - 🧠 **Memory Management** - Index new content, detect duplicates, optimize
   - 📈 **Improvements** - Analyze patterns, suggest optimizations, learn from usage
   - 🚨 **Monitoring** - Track errors, usage, resource consumption, send alerts

3. **Self-Correction**:
   - Learns from previous iterations
   - Adjusts tactics based on failures
   - Pauses after 3 consecutive failures
   - Logs all actions for transparency

### Configuration

Add to `ant.config.json`:

```json
{
  "mainAgent": {
    "enabled": true,
    "iterationDelayMinutes": 5,
    "maxIterationsPerTask": 10,
    "maxConsecutiveFailures": 3,
    "dutiesFile": "AGENT_DUTIES.md",
    "logFile": "AGENT_LOG.md",
    "alertOwnerOnCritical": true
  }
}
```

### Define Your Duties

Create `AGENT_DUTIES.md` in your project root:

```markdown
# Main Agent Duties

## 1. Subagent Management
- Read `.ant/subagents.json` for active tasks
- Check if any subagent has been running > 10 minutes
- Flag stuck/failed subagents and attempt restart
- Archive completed runs older than 24 hours

## 2. System Maintenance
- Delete session files older than 30 days
- Warn if any single session exceeds 10 MB
- Test provider connectivity (embeddings model)
- Check available disk space in `.ant/`

## 3. Memory Management
- Re-index memory if new content detected
- Archive old sessions as memory summaries
- Detect broken internal links
- Consolidate duplicate entries

## 4. Improvements & Optimization
- Analyze tool usage patterns from session history
- Suggest new tools based on common requests
- Identify repetitive tasks for automation
- Review error logs for optimization opportunities

## 5. Monitoring & Alerting
- Count errors in last 1000 log lines
- Track provider API usage/costs
- Detect unusual activity patterns
- Send WhatsApp alert if critical threshold reached

## Completion
After checking all duties, output:
<promise>DUTY_CYCLE_COMPLETE</promise>
```

### Monitoring the Main Agent

```bash
# View duty execution log
tail -f AGENT_LOG.md

# Check Main Agent session
ant sessions view "agent:main:system"

# Monitor in TUI dashboard
ant start --tui

# Check status
ant main-agent status
```

### Best Practices

✅ **Clear, actionable duties** - Each duty should have specific steps
✅ **Idempotent operations** - Safe to run multiple times
✅ **Log everything** - Append to AGENT_LOG.md with timestamps
✅ **Graceful failures** - Try alternatives, don't crash
✅ **Owner notifications** - Ask for help on uncertain decisions

---

## Available Tools (40+)

The agent has access to comprehensive tools for system control:

**File Operations**: `read`, `write`, `append`, `ls`, `mkdir`, `rm`
**Execution**: `exec`, `open_app`, `restart_ant`
**Media**: `screenshot`, `screen_record`, `send_file`
**Browser**: `browser` (Playwright automation)
**Memory**: `memory_search`, `memory_get`, `memory_recall`
**Messages**: `message_send`, `sessions_spawn`, `sessions_send`
**External CLI**: `external_cli` (Codex, Copilot, Claude)
**Social**: `bird` (Twitter/X via bird CLI)

For full tool documentation, run:
```bash
ant list-tools
ant tool <tool-name>
```

---

## Documentation

- **[PROJECT.md](PROJECT.md)** - Complete technical documentation
- **[AGENT_DUTIES.md](AGENT_DUTIES.md)** - Main Agent responsibilities template
- **[AGENT_LOG.md](AGENT_LOG.md)** - Main Agent activity log
- **[AGENTS.md](AGENTS.md)** - Quick reference for AI agents

## License

MIT

# ANT CLI

A modular, autonomous AI agent runtime that runs locally on your machine. Connect via WhatsApp, CLI, or Web interface. ANT manages memory, schedules tasks, and continuously improves itself.

## Features

- **Multi-Channel Support** - Interact via WhatsApp, CLI commands, or Web UI
- **Cron Scheduling** - Schedule recurring agent tasks with cron expressions
- **Memory System** - Semantic search with embeddings over notes and session history
- **Self-Improvement** - Skill generation and autonomous learning from interactions
- **Monitoring & Alerting** - Live dashboards, logging, and critical error alerts
- **Subagents** - Spawn parallel workers for complex tasks
- **Local Tools** - File operations, shell commands, screenshots, browser automation
- **Pluggable Providers** - OpenAI-compatible APIs (LM Studio) or CLI tools (Codex, Claude, Copilot)

## Installation

```bash
# Clone and install
git clone <repo-url>
cd ant-cli
npm install

# Build the project
npm run build

# (Optional) Build the web UI
npm run ui:build
```

### Requirements

- Node.js 22+
- WhatsApp account (for QR pairing)
- LM Studio or any OpenAI-compatible API (for local LLM)

## Quick Start

1. **Create configuration** - Copy and customize `ant.config.json`:

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
  }
}
```

2. **Start the runtime**:

```bash
ant start -c ant.config.json
```

3. **Scan the QR code** to pair with WhatsApp, then start chatting!

## CLI Commands Reference

### Runtime

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
| `ant schedule add "<cron>" -p "<prompt>"` | Schedule a recurring prompt |
| `ant schedule add "0 9 * * *" -n "daily" -p "Check email"` | Daily 9am task |
| `ant schedule list` | List all scheduled jobs |
| `ant schedule run <jobId>` | Manually trigger a job |
| `ant schedule remove <jobId>` | Delete a scheduled job |

### Memory

| Command | Description |
|---------|-------------|
| `ant remember "<note>"` | Add a note to memory |
| `ant remember --category work "<note>"` | Add with category |
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

### Tools

| Command | Description |
|---------|-------------|
| `ant list-tools` | Show all available tools |
| `ant tool <name>` | Get tool details and schema |

### Utilities

| Command | Description |
|---------|-------------|
| `ant onboard` | Interactive setup wizard |
| `ant mcp-server` | Run MCP server over stdio |
| `ant subagents list` | List active subagents |
| `ant subagents cleanup` | Clean up completed subagents |

### Debug

| Command | Description |
|---------|-------------|
| `ant debug run "<prompt>"` | Run prompt without WhatsApp |
| `ant debug simulate "<text>"` | Simulate inbound message |

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
        "embeddingsModel": "embedding-model"
      },
      "codex-cli": {
        "type": "cli",
        "cliProvider": "codex"
      }
    }
  },
  "routing": {
    "chat": "codex-cli",            // Provider for chat responses
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
│  Tools  │  │ Providers│  │ Memory  │  │ Scheduler │
│         │  │          │  │         │  │           │
│ • File  │  │ • OpenAI │  │ • SQLite│  │ • Cron    │
│ • Exec  │  │ • CLI    │  │ • Vector│  │ • Jobs    │
│ • Media │  │   tools  │  │ • Search│  │           │
│ • Browse│  │          │  │         │  │           │
└─────────┘  └──────────┘  └─────────┘  └───────────┘
                                │
                                ▼
                          ┌───────────┐
                          │ Monitoring│
                          │ • Metrics │
                          │ • Alerts  │
                          │ • Events  │
                          └───────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Channels | `src/channels/` | WhatsApp, CLI, Web adapters |
| Agent | `src/agent/` | Core agent logic, skill generation |
| Tools | `src/tools/` | Built-in tool implementations |
| Memory | `src/memory/` | Embeddings, SQLite store, file watcher |
| Scheduler | `src/scheduler/` | Cron job management |
| Monitor | `src/monitor/` | Metrics, alerting, event streaming |
| Gateway | `src/gateway/` | HTTP API for external integrations |
| CLI | `src/cli/` | Command-line interface |

### Data Storage

```
.ant/
├── whatsapp/          # WhatsApp session data
├── sessions/          # Conversation history (JSONL)
├── memory.sqlite      # Embeddings database
├── jobs.json          # Scheduled jobs
└── ant.log            # Runtime logs

~/.ant/
└── ant.log            # Default log location
```

## Documentation

- **[PROJECT.md](PROJECT.md)** - Complete technical documentation
- **[AGENTS.md](AGENTS.md)** - Quick reference for AI agents

## License

MIT

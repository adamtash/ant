# ant

A lightweight, autonomous assistant that runs on your own machine and talks to you over WhatsApp. ant can use local tools, manage subagents, and keep memory from past sessions.

## Highlights
- WhatsApp-first agent (Baileys-based) with typing indicators and media replies.
- Local tool execution (files, commands, screenshots, browser automation).
- Subagents for parallel work.
- Memory indexing with embeddings (SQLite + optional session transcript indexing).
- Pluggable providers (OpenAI-compatible, CLI providers like Codex/Copilot/Claude).
- Optional live TUI to visualize main/subagent activity.

## Requirements
- Node.js 22+
- WhatsApp account for QR pairing
- LM Studio (or any OpenAI-compatible API)

## Quick start

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

## TUI mode (optional)
Shows main/subagent activity, queue lanes, and timing.

```bash
npm run dev -- run -c ant.config.json --tui
```

Logs still go to `~/.ant/ant.log`.

## Tools (built-in)
- File: `read`, `write`, `ls`
- Commands: `exec`, `open_app`, `restart_ant`
- Media: `screenshot`, `screen_record`, `send_file`
- Browser: `browser` (Playwright)
- Memory: `memory_search`, `memory_get`
- Subagents: `sessions_spawn`, `sessions_send`
- Messaging: `message_send`
- External CLI: `external_cli` (Codex/Copilot/Claude) when enabled
- Twitter/X: `bird` (requires bird CLI)

## macOS permissions
For screenshots and automation, grant Terminal (or your Node binary) Screen Recording + Accessibility.
Use the tool:
```
macos_permissions
```

## Memory
ant indexes:
- `MEMORY.md` / `memory.md`
- `memory/*.md`
- session transcripts (`.ant/sessions/*.jsonl`)

Use `/memory <note>` or `/remember <note>` in chat to append to memory.

## Restarting ant
Say "restart ant" and the `restart_ant` tool will run the configured command and exit the current process.

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

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

## Web UI
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

## TUI mode (optional)
The TUI shows a two-column live dashboard with log tail and key hints (`p` pause, `q` quit, `?` help).

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

## Browser tool (CDP + proxy)
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

You can also use the CLI:
```bash
ant stop
ant restart
```

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

## TUI mode (optional)
Shows main/subagent activity, queue lanes, and timing.

```bash
npm run dev -- run -c ant.config.json --tui
```

Logs still go to `~/.ant/ant.log`.

## Web UI (ant-ui)
ant exposes a local UI API (default: `http://127.0.0.1:5117`). The separate `ant-ui` app can connect to it.

Config options:
```json
"ui": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 5117,
  "autoOpen": true,
  "openUrl": "http://127.0.0.1:5117"
}
```

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

## Browser tool (CDP + proxy)
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

You can also use the CLI:
```bash
ant stop
ant restart
```

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

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

## Browser tool (CDP + proxy)
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

You can also use the CLI:
```bash
ant stop
ant restart
```

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

## TUI mode (optional)
Shows main/subagent activity, queue lanes, and timing.

```bash
npm run dev -- run -c ant.config.json --tui
```

Logs still go to `~/.ant/ant.log`.

## Web UI (ant-ui)
ant exposes a local UI API (default: `http://127.0.0.1:5117`). The separate `ant-ui` app can connect to it.

Config options:
```json
"ui": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 5117,
  "autoOpen": true,
  "openUrl": "http://127.0.0.1:5117"
}
```

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

## Browser tool (CDP + proxy)
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

You can also use the CLI:
```bash
ant stop
ant restart
```

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

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

## Browser tool (CDP + proxy)
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

You can also use the CLI:
```bash
ant stop
ant restart
```

## Logs
- File: `~/.ant/ant.log`
- Adjust logging in `ant.config.json`:
```json
"logging": { "level": "debug", "fileLevel": "trace" }
```

## WhatsApp startup message (optional)
Send a message when ant boots:
```json
"whatsapp": {
  "startupMessage": "ant is online",
  "startupRecipients": ["123456789@s.whatsapp.net"]
}
```
If `startupRecipients` is empty, ant falls back to `ownerJids` or your own JID when available.

## Notes
- ant runs locally; be careful with destructive commands.
- `respondToSelfOnly: true` keeps replies to your own DM.
- For large media, prefer shorter recordings or smaller images.

## License
MIT

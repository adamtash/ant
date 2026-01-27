# ant — Agent Notes

## Repo & Goal
- Repo root: `/Users/a/Projects/ant-cli`
- GitHub: https://github.com/adamtash/ant
- Product: **ant** — local autonomous assistant with WhatsApp integration, tools, memory, and subagents.
- Core goals: single OpenAI-compatible provider (LM Studio), WhatsApp chat, subagents, memory indexing, host-only tool execution (no sandbox for now).

## Current Runtime Overview
- CLI entry: `src/cli.ts`
- Runtime: `src/runtime/run.ts`
- Agent core: `src/runtime/agent.ts`
- Tools: `src/runtime/tools.ts`
- Subagents: `src/runtime/subagents.ts`
- Queue: `src/runtime/queue.ts`
- Sessions: `src/runtime/session-store.ts`
- Memory: `src/memory/manager.ts`
- WhatsApp: `src/whatsapp/client.ts`
- TUI: `src/runtime/tui.ts`

## Key Behaviors Implemented
- **Media pipeline**: tools return `MEDIA:/path` tokens; `run.ts` parses and sends media replies.
- **Direct tool fast‑paths**: `open_app` and `restart_ant` invoked without model involvement.
- **CLI provider support**: parent LLM handles tools; CLI prompt includes history + memory recall summary.
- **Memory**: embeddings + SQLite. `memory_search` forces session transcript reindexing on search.
- **TUI**: `--tui` shows main/subagent status; uses alternate screen; console logs suppressed in TUI.

## Tools (built‑in)
- File: `read`, `write`, `ls`
- Commands: `exec`, `open_app`, `restart_ant`
- Media: `screenshot`, `screen_record`, `send_file`
- Browser: `browser` (Playwright)
- Memory: `memory_search`, `memory_get`
- Subagents: `sessions_spawn`, `sessions_send`
- Messaging: `message_send`
- External CLI: `external_cli` (Codex/Copilot/Claude)
- Twitter/X: `bird` (requires bird CLI)

## Config
- Primary config: `ant.config.json`
- Logging: `~/.ant/ant.log` by default
- WhatsApp session dir: `~/.ant/whatsapp` (via config)
- Memory DB: `~/.ant/memory.sqlite`
- Restart tool: `runtime.restart` command in config

## Running
```bash
npm install
npm run dev -- run -c ant.config.json
# Optional TUI
npm run dev -- run -c ant.config.json --tui
```

## Known Issues / Notes
- `restart_ant` uses `npm run dev` and can hit TSX pipe permissions; workaround: `rm -rf /var/folders/*/T/tsx-501` or switch restart to `node dist/cli.js`.
- WhatsApp respond‑to‑self uses JID/LID checks; `respondToSelfOnly: true` is set in config.

## Where to Look for Behavior
- Prompt rules: `src/runtime/prompt.ts`
- Media parsing: `src/runtime/media.ts`
- Tool execution logs: `~/.ant/ant.log`

## Style / Conventions
- TypeScript (ESM). Keep files concise. Add brief comments only for tricky logic.
- Default to ASCII in code.

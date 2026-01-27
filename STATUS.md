# Status

Last update: 2026-01-27

## Repo
- Location: `/Users/a/Projects/ant-cli`
- GitHub: https://github.com/adamtash/ant

## Implemented
- WhatsApp listener (Baileys) with typing indicator
- Tool system (exec, file ops, screenshot, browser, bird, etc.)
- Subagent orchestration + persistence
- Memory indexing (SQLite + embeddings; session transcript indexing)
- Media reply pipeline using `MEDIA:` tokens
- CLI provider support (Codex/Copilot/Claude) with parent tool runner
- Live TUI (`--tui`) for main + subagent status
- `open_app` and `restart_ant` direct tool fast‑paths

## Known Issues
- `restart_ant` can fail due to TSX IPC pipe permissions; workaround: remove `/var/folders/*/T/tsx-501` or switch restart to `node dist/cli.js`.

## Next
- Decide whether to keep TSX runtime or build+run `dist/` for restarts.
- Expand fast‑path intents (open browser, screenshot, list files).
- Add more robustness: retries/backoff for WhatsApp and provider calls.

# ant project memory

- Repo location: `/Users/a/Projects/ant-cli`
- GitHub: https://github.com/adamtash/ant
- ant is a local WhatsApp‑first agent with tools, subagents, memory, and optional TUI.
- Media replies use `MEDIA:/path` tokens parsed in `src/runtime/run.ts`.
- CLI providers (Codex/Copilot/Claude) are supported via parent LLM; CLI prompt includes history + memory summary.
- Direct tool fast‑paths implemented for `open_app` and `restart_ant`.
- TUI uses alternate screen; console logs disabled when `--tui` is active.
- Memory search forces session reindex on search to capture recent conversation.

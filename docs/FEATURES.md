# Features

## WhatsApp
- Web-based integration using Baileys.
- Self-DM support (controlled by `whatsapp.allowSelfMessages`).
- Self-only reply mode with `whatsapp.respondToSelfOnly`.
- Group gating using mentions, bot name, or `mentionKeywords`.
- Typing indicator support (`whatsapp.typingIndicator`).
- OS control tools (read/write/exec/ls) plus screenshot and screen recording capture.
- Twitter/X access via bird CLI.
- Headless browser automation via Playwright.

## Providers + routing
- Multiple providers (OpenAI-compatible APIs and CLI providers).
- Route chat, tools, embeddings, summaries, and subagents per action.
- CLI providers run single-turn responses; tool calls are handled by a parent LLM.

## Subagents
- Spawn parallel runs using `sessions_spawn` tool.
- Results are announced back to the requester chat.
- Registry stored under `.ant/subagents.json`.

## Memory
- Embeddings + sqlite index for MEMORY.md + memory/*.md.
- Session transcripts indexed by default.
- Configurable transcript sync policies (startup, search, watch, interval).
- Tools: `memory_search` and `memory_get`.

## Debugging
- `ant debug run` for prompt-only runs.
- `ant debug simulate` for full inbound flow without WhatsApp.

## External CLI tools
- `external_cli` tool routes prompts to Codex, Copilot, or Claude CLIs.
- Uses non-interactive modes and captures final output:
  - Codex: `codex exec --output-last-message`
  - Copilot: `copilot -p --silent`
  - Claude: `claude --print --output-format text`

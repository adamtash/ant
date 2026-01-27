# Ant Agent Notes

## Goal
Build a minimal but robust CLI named **ant** with:
- Single provider: LM Studio (OpenAI-compatible API)
- WhatsApp integration (Baileys)
- Subagents as a core feature
- Memory system: embeddings + sqlite + default session transcript indexing
- Host-only tool execution (no sandbox for v1)

## Current State
- Worktree created at `/Users/a/Projects/ant` (branch `ant-main`).
- New CLI scaffold lives under `ant/`.
- Core runtime implemented:
  - `ant/src/runtime/agent.ts`
  - `ant/src/runtime/run.ts`
  - `ant/src/runtime/queue.ts`
  - `ant/src/runtime/subagents.ts`
  - `ant/src/runtime/session-store.ts`
  - `ant/src/runtime/prompt.ts`
  - `ant/src/runtime/*-cli.ts`
  - `ant/src/runtime/openai.ts`
  - `ant/src/runtime/paths.ts`
  - `ant/src/runtime/context.ts`
- Memory system:
  - `ant/src/memory/manager.ts`
  - `ant/src/memory/index.ts`
- WhatsApp integration:
  - `ant/src/whatsapp/client.ts`
- Config template:
  - `ant/ant.config.json`

## Next Steps (Recommended)
1) Install deps: `pnpm install`.
2) Configure `ant.config.json` for LM Studio and WhatsApp.
3) Run: `pnpm dev -- run -c ant.config.json`.

## Notes
- Keep new CLI isolated inside `ant/` to avoid mixing with Clawdbot sources.
- Use JSON config only.
- Default to indexing session transcripts in memory.

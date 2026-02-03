# Improvement Log

## Ideas
- Align job execution timeout with cliTools.timeoutMs to avoid light check timeouts.
- Reduce noise from system/cron session warnings by registering sessions or filtering "session not found" for system contexts.
- Add provider fallback for scheduled jobs when Codex hits usage limits (detect 429 and avoid retry storms).
- Reduce codex provider failures by adding fallback for runCLI non-zero exit (detect and switch provider).

## Done
- Suppress session-not-found warnings for system/cron session keys without channel context to reduce log noise.

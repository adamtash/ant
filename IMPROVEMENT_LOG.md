# Improvement Log

## Ideas
- Align job execution timeout with cliTools.timeoutMs to avoid light check timeouts.
- Reduce noise from system/cron session warnings by registering sessions or filtering "session not found" for system contexts. (Implemented: skip warnings for system sessions without recoverable channel.)
- Add provider fallback for scheduled jobs when Codex hits usage limits (detect 429 and avoid retry storms).
- Reduce codex provider failures by adding fallback for runCLI non-zero exit (detect and switch provider).
- **Log Rotation**: ant.log has grown to 80MB. Consider implementing automatic log rotation to prevent unbounded growth.
- **Session File Cleanup**: Large cron flight session files (1.7MB+) may need periodic summarization or archiving.

## Done
- Suppress session-not-found warnings for system/cron session keys without channel context to reduce log noise.
 - Align router session queue timeout with cliTools.timeoutMs to avoid processing timeouts for long tool loops.

## Ideas
- [2026-02-03 14:26:36] Log rotation still needed; ant.log now ~73MB. Consider implementing rotation/retention policy.
- [2026-02-03 15:38:55] Light-check error counts scan full ant.log; switch to time-windowed or tail-based counts to avoid false critical alerts.

# Known Issues

This file tracks recurring issues and their solutions for autonomous fixing by the Main Agent.

## Format

```
## Issue ID: [unique-id]
**Description**: Brief description
**Pattern**: Log pattern to match
**Root Cause**: Why it happens
**Solution**: How to fix
**Fixed**: true/false
**Auto-Fixable**: true/false
```

---

## Issue ID: INTEGRATION-TEST-TIMEOUT
**Description**: Integration tests timeout after 120s (vs 300ms normally)
**Pattern**: "npm test hanging" or "tests have gateway timeout issues" or "Gateway failed to start (timeout after 15000ms)"
**Root Cause**: Gateway integration tests start server on port 5117, conflicts with running instance
**Solution**: 
1. Stop running ant instance before testing, OR
2. Use different port for tests (configurable), OR
3. Skip integration tests with `npm run test:unit`
**Fixed**: false
**Auto-Fixable**: false (requires architectural change)
**Workaround**: Use `npm run test:unit` for quick unit test validation

## Issue ID: CLI-PROVIDER-TIMEOUT
**Description**: CLI providers (Kimi/Copilot) time out after 120s during complex tasks
**Pattern**: "Provider call timed out after 120000ms" or "Command timed out after 120000ms"
**Root Cause**: Complex tasks with many tool calls exceed default 120s timeout
**Solution**: 
1. Increase timeoutMs in ant.config.json (e.g., 300000 for 5 min)
2. Break tasks into smaller sub-tasks
3. Use different provider for complex tasks
**Fixed**: false
**Auto-Fixable**: false (user preference)
**Note**: Current config has timeoutMs: 1200000 - may need increase for heavy tasks

## Issue ID: ROUTER-PROCESSING-TIMEOUT
**Description**: Router message processing fails with timeout at 300s for long-running tasks
**Pattern**: "Timeout: Message processing took longer than 300s" or "Message processing failed" with that error
**Root Cause**: Router session queue timeout (300s) shorter than cliTools timeout, so long tool loops exceed router guard.
**Solution**:
1. Align router sessionOrdering.queueTimeoutMs with cliTools.timeoutMs (default 1,200,000ms).
2. Use config-driven timeout to avoid mismatch when cliTools timeout changes.
**Fixed**: true (runtime start + harness now use cliTools.timeoutMs)
**Auto-Fixable**: true

## Issue ID: CODEX-CLI-PROMPT-ARG
**Description**: Codex CLI fails with "unexpected argument '-q'"
**Pattern**: "error: unexpected argument '-q' found" or "CLI codex error"
**Root Cause**: Codex CLI expects prompt via stdin when args include "-" (exec mode), but code passed "-q"
**Solution**:
1. When args include "-" (stdin prompt), write the prompt to stdin instead of using -q
2. Otherwise pass prompt as positional argument
**Fixed**: true (updated runCLI prompt handling)
**Auto-Fixable**: true

## Issue ID: ESLINT-MISSING
**Description**: Lint fails because eslint binary is missing
**Pattern**: "eslint: command not found"
**Root Cause**: eslint is not installed in node_modules/.bin
**Solution**:
1. Install eslint as a dev dependency, OR
2. Skip lint in environments without eslint
**Fixed**: false
**Auto-Fixable**: false (depends on environment constraints)

## Issue ID: WHATSAPP-RECONNECT-CONFLICT
**Description**: WhatsApp stream error on reconnect (conflict replaced)
**Pattern**: "stream:error conflict replaced"
**Root Cause**: WhatsApp Web session conflict when reconnecting
**Solution**: Automatic - Baileys handles reconnection with backoff
**Fixed**: true
**Auto-Fixable**: true (handled by Baileys library)
**Note**: Normal behavior, no action needed

## Issue ID: UNCOMMITTED-CHANGES
**Description**: Large number of uncommitted changes accumulating
**Pattern**: "[X] uncommitted changes" in logs
**Root Cause**: Active development without regular commits
**Solution**: Review changes and commit when stable
**Fixed**: false
**Auto-Fixable**: false (requires human decision)
**Note**: 77+ uncommitted changes including HARDENING_PLAN.md, UI_FIX_PLAN.md, etc.

## Issue ID: MEMORY-DB-SCHEMA
**Description**: Memory database schema mismatch (historical)
**Pattern**: "Schema mismatch in memory.sqlite" or "missing 'updated_at' column"
**Root Cause**: Old SQLite schema vs new code expecting different columns
**Solution**: 
1. Delete .ant/memory.sqlite to reset, OR
2. Run migration if migration tool available
**Fixed**: true (resolved by fresh setup)
**Auto-Fixable**: true (delete and reindex)
**Note**: No longer occurring since memory.sqlite not present

## Issue ID: ESM-CJS-COMPATIBILITY
**Description**: "require is not defined" in ESM modules
**Pattern**: "ReferenceError: require is not defined"
**Root Cause**: Using require() in ESM (TypeScript compiled to ESM)
**Solution**: Replace require() with ESM import syntax
**Fixed**: true (fixed in event-store.ts:425)
**Auto-Fixable**: true
**Example Fix**: 
- Before: `const fs = require('node:fs')`
- After: `import fs from 'node:fs/promises'`

## Issue ID: UNIT-TEST-MOCK-MISSING
**Description**: Unit tests fail due to missing mock for getDefinitionsForPolicy
**Pattern**: "should execute tools" or "should respect max iterations" failing
**Root Cause**: Tests didn't mock new getDefinitionsForPolicy method
**Solution**: Add mock for getDefinitionsForPolicy in test setup
**Fixed**: true (fixed in tests/unit/agent/engine.test.ts)
**Auto-Fixable**: true

## Issue ID: CODEX-USAGE-LIMIT
**Description**: Codex CLI fails with usage_limit_reached or HTTP 429.
**Pattern**: "usage_limit_reached" or "You've hit your usage limit" or "http 429 Too Many Requests"
**Root Cause**: OpenAI/Codex usage quota exceeded for the configured account.
**Solution**:
1. Switch routing to another provider (copilot/kimi/lmstudio) for scheduled jobs.
2. Wait for quota reset time or request a limit increase from admin.
3. Consider short-circuiting codex provider when this pattern appears.
**Fixed**: true (mitigated by switching default routing to copilot)
**Auto-Fixable**: false (requires quota or routing change)
**Note**: Config updated 2026-02-03 to use copilot as default provider to avoid Codex rate limits.

---

## Open Issues (Not Yet Fixed)

1. **Integration Test Port Conflict** - Needs architectural change (dynamic test ports)
2. **Kimi CLI Timeout on Complex Tasks** - May need timeout adjustment or provider switching
3. **Uncommitted Changes Accumulation** - Needs git workflow decision

## Issue ID: INTEGRATION-TEST-PORT-CONFLICT
**Description**: Integration tests intermittently fail with ECONNREFUSED on 127.0.0.1:18000
**Pattern**: "connect ECONNREFUSED 127.0.0.1:18000" or "Gateway failed to start (timeout after 15000ms)"
**Root Cause**: findAvailablePort() could race by returning a port that is free at check time but used before server binds.
**Solution**: Use ephemeral port selection (0) and read actual bound port from server.address().
**Fixed**: true (tests/integration/setup.ts)
**Auto-Fixable**: true

## Issue ID: CODEX-MODEL-REFRESH-TIMEOUT
**Description**: Codex CLI logs "failed to refresh available models: timeout waiting for child process to exit"
**Pattern**: "codex_core::models_manager::manager: failed to refresh available models: timeout waiting for child process to exit"
**Root Cause**: Codex CLI model manager refresh hangs or takes too long to exit.
**Solution**:
1. Retry with provider fallback (copilot/kimi) for the task.
2. Restart/update codex CLI if the error persists.
**Fixed**: false
**Auto-Fixable**: false

## Issue ID: SESSION-NOT-FOUND-WARN
**Description**: Router warns "Session not found and could not be recovered" for system/cron sessions.
**Pattern**: "Session not found and could not be recovered"
**Root Cause**: sendToSession expects session keys like channel:type:chatId; cron/main-agent session keys (e.g., cron:flight:light-check) lack a channel for recovery.
**Solution**:
1. Pre-register system sessions or send via channel-specific adapters.
2. Suppress warnings and error events for system-only session keys.
**Fixed**: true (skip warnings for system sessions without a recoverable channel)
**Auto-Fixable**: true

## Issue ID: CONFIG-ROUTING-DUPLICATE
**Description**: TypeScript build fails due to duplicate RoutingSchema/RoutingOutput declarations.
**Pattern**: "Cannot redeclare block-scoped variable 'RoutingSchema'" or "Duplicate identifier 'RoutingOutput'"
**Root Cause**: Routing schema defined twice in src/config.ts.
**Solution**:
1. Remove the earlier duplicate RoutingSchema/RoutingOutput block.
2. Rebuild to confirm.
**Fixed**: true
**Auto-Fixable**: true

## Issue ID: SESSION-NOT-FOUND-SYSTEM-QUIET
**Description**: Session-not-found warnings for system/cron session keys without channel context.
**Pattern**: "Session not found and could not be recovered" for sessionKey starting with cron:/agent:/subagent:/system:
**Root Cause**: System sessions lack channel/type/chatId for recovery.
**Solution**: Skip send attempts for system-only session keys; avoid warning/error emission.
**Fixed**: true
**Auto-Fixable**: true

## Issue ID: CLI-PROVIDER-PROCESS-CLOSED
**Description**: CLI provider calls intermittently fail with "runCLI: Process closed"
**Pattern**: "runCLI: Process closed" or "CLI provider chat call failed"
**Root Cause**: Unknown; likely provider CLI instability or rate limiting
**Solution**:
1. Retry with provider fallback order (codex -> copilot -> kimi -> lmstudio)
2. Check provider connectivity and quotas
3. Consider adding retry/backoff or health gating
**Fixed**: false
**Auto-Fixable**: false
**First Seen**: 2026-02-03

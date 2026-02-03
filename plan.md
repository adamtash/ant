# Plan: Autonomous Self-Healing Ant Colony System

This is a major architectural enhancement spanning 9 workstreams that can be developed in parallel. The goal is to make the ant-cli system fully autonomous, observable, self-healing, and production-ready with intelligent provider routing and unified memory management.

**TL;DR**: Implement tiered provider routing with automatic failover and WhatsApp notifications, add real-time task observability to UI, create prioritized memory categorization, enhance Main Agent (Queen Ant) to autonomously detect/delegate/fix issues, add hot-reload configuration, fix LM Studio tool call parsing, **auto-discover free AI API providers as backups**, **add a lightweight watchdog process**, and **make the system production-ready with Docker support**. Each workstream maps to a subagent that can execute independently.

---

## Workstream 1: Tiered Provider Routing & Intelligent Failover

**Goal**: Different providers for different task types with automatic failover, self-investigation, and WhatsApp notifications.

**Steps**:

1. **Extend routing config schema** in `src/config.ts` to support tiered routing:
   ```typescript
   routing.tiers: {
     fast: { provider, model, maxLatencyMs },
     quality: { provider, model, fallbackFromFast: true },
     background: { provider, model },
     backgroundImportant: { provider, model },
     embeddings: { provider, model },
     summarizer: { provider, model },
     maintenance: { provider, model }  // For self-healing tasks
   }
   ```

2. **Create tier resolver** in new file `src/routing/tier-resolver.ts`:
   - `resolveTierForIntent(intent)` - Analyze task complexity and urgency
   - Intent classification: fast response (simple queries), quality (complex/failed), background (async), embeddings, summarization

3. **Enhance failover logic** in `src/agent/providers.ts`:
   - Add `onFailover` callback that triggers WhatsApp notification
   - Create `FailoverInvestigator` class that spawns maintenance subagent to:
     - Diagnose why primary provider failed
     - Attempt auto-fix (e.g., restart LM Studio, clear cache)
     - Report findings to memory

4. **Add WhatsApp notification on failover** in `src/agent/engine.ts`:
   - Hook into `callProviderWithFallback()` to emit failover events
   - Send formatted WhatsApp message: "⚠️ Provider {primary} failed ({reason}). Switched to {fallback}. Investigation started."

5. **Implement tier escalation** - If fast tier fails, auto-promote to quality tier

**Verification**: Test with intentionally broken provider, verify WhatsApp notification received, check investigation subagent spawned.

---

## Workstream 2: Real-time Task Observability & UI Overhaul

**Goal**: Clear visibility into what's processing, which provider, progress status in UI.

**Steps**:

1. **Create task execution tracker** in new file `src/agent/task/execution-tracker.ts`:
   - Track per-task: `startTime`, `provider`, `model`, `toolChain[]`, `phase`, `lastActivity`
   - Emit granular events: `task_phase_changed`, `tool_chain_updated`, `provider_switched`

2. **Enhance WebSocket events** in `src/gateway/server.ts`:
   - Add `task_detail` event type with full execution state
   - Add `tool_stream` for real-time tool execution visibility (inspired by OpenClaw's `ToolStreamEntry`)
   - Add `provider_status` event for health changes

3. **Overhaul Royal Chamber page** in `ui/src/pages/RoyalChamber.tsx`:
   - **Add Task Detail Panel**: Shows active task with:
     - Current provider/model
     - Tool execution chain with timing
     - Phase indicator (queued → thinking → tool_call → responding)
     - Progress bar based on tool iterations
   - **Add Provider Dashboard**: Real-time provider status grid
   - **Add Log Stream**: Scrolling filtered log view (errors prominently displayed)

4. **Create Task Drill-down View** in new file `ui/src/pages/TaskDetail.tsx`:
   - Full tool call history with args/results
   - Provider switch timeline
   - Error details with stack traces
   - Memory recall used during task

5. **Add Loading/Processing States** across UI:
   - Clear indicators when a task is running
   - Which queue lane it's in
   - Estimated time remaining (based on historical data)

**Verification**: Send WhatsApp message, observe real-time updates in UI showing provider, tool calls, progress.

---

## Workstream 3: Prioritized Memory Categorization

**Goal**: Categorize memory by importance so large memories can be pruned intelligently.

**Steps**:

1. **Define memory categories** in `src/memory/types.ts` (or create):
   ```typescript
   type MemoryCategory = 
     | 'critical'      // User preferences, critical configs
     | 'important'     // Successful task patterns, learned fixes
     | 'contextual'    // Session context, recent interactions  
     | 'ephemeral'     // Temporary notes, debug info
     | 'diagnostic';   // Error logs, investigation results
   
   type MemoryEntry = {
     id, content, embedding, category,
     priority: 1-10,  // Within category
     createdAt, lastAccessedAt, accessCount,
     decay?: number   // Relevance decay over time
   };
   ```

2. **Add category columns** to SQLite schema in `src/memory/manager.ts`:
   - Migration: `ALTER TABLE chunks ADD COLUMN category TEXT DEFAULT 'contextual'`
   - Add `priority INTEGER`, `access_count INTEGER`, `last_accessed_at INTEGER`

3. **Implement auto-categorization** in new file `src/memory/categorizer.ts`:
   - Use LLM (summarizer tier) to classify memory chunks on insert
   - Pattern-based fast classifier for common types:
     - `/user prefers|always|never/i` → critical
     - `/error|exception|failed/i` → diagnostic
     - `/fixed|solved|resolved/i` → important

4. **Add memory pruning** in `src/memory/pruner.ts`:
   - `prune(targetSizeBytes, categories)` - Removes lowest priority first
   - Preserve critical/important, prune ephemeral/diagnostic first
   - Apply decay: older + low-access = lower effective priority

5. **Enhance `/memory` command** to support categories:
   - `/memory important: API keys are in ~/.secrets`
   - Auto-parse category prefix or infer from content

6. **Create Memory Browser** in UI (`ui/src/pages/ArchiveChambers.tsx`):
   - Category filter tabs
   - Priority sorting
   - Manual recategorization
   - Storage usage by category

**Verification**: Add memories of different types, verify categorization, trigger pruning, check important memories preserved.

---

## Workstream 4: Queen Ant Autonomous Orchestration

**Goal**: Main Agent autonomously detects errors, delegates fixes to subagents, notifies user of actions taken.

**Steps**:

1. **Enhance Main Agent duty cycle** in `src/agent/main-agent.ts`:
   - Add `scanForErrors()` - Check error logs since last cycle
   - Add `spawnInvestigationTask(error)` - Create background subagent
   - Add `notifyUserAction(action, details)` - WhatsApp message with summary

2. **Create Investigation Subagent Template** in `src/agent/templates/investigation.ts`:
   - Standardized prompt for error investigation
   - Access to: error logs, config, provider status, memory
   - Output format: `{ diagnosis, fixApplied, fixResult, recommendation }`

3. **Add action notification system**:
   - On error detected: "🔍 Detected error in {context}. Starting investigation..."
   - On fix applied: "✅ Auto-fixed: {summary}. Details saved to memory."
   - On escalation: "⚠️ Could not auto-fix {error}. Recommendation: {action}"

4. **Implement resume-after-restart** in `src/agent/task/task-store.ts`:
   - Persist running tasks with checkpoint data
   - On boot, scan for incomplete tasks
   - Resume or retry based on task type

5. **Add pause/resume API** for Main Agent:
   - `POST /api/main-agent/pause` - Stop duty cycles
   - `POST /api/main-agent/resume` - Restart duty cycles
   - Expose via WhatsApp commands: `/queen pause`, `/queen resume`

6. **Implement learning patterns**:
   - Track successful fixes in memory (important category)
   - Before investigating, check memory for similar past issues
   - Apply known fixes first before deep investigation

**Verification**: Introduce an error, verify Main Agent detects it, spawns subagent, notifies via WhatsApp, and saves summary to memory.

---

## Workstream 5: Hot-Reload Configuration

**Goal**: Change config without restart; auto-restart if necessary and resume where left off.

**Steps**:

1. **Create config watcher** in new file `src/config/watcher.ts`:
   - Use chokidar to watch `ant.config.json`
   - Debounce changes (300ms)
   - Emit `config_changed` event with diff

2. **Implement reload rules** (inspired by OpenClaw) in `src/config/reload-rules.ts`:
   - Per-config-path rules: `{ prefix, kind: 'hot'|'restart'|'none', actions }`
   - Hot-reloadable: `routing.*`, `memory.query.*`, `agent.thinking.*`
   - Requires restart: `providers.*`, `gateway.*`, `whatsapp.*`

3. **Create reload plan generator**:
   - `generateReloadPlan(diff)` → `{ actions: string[], requiresRestart: boolean }`
   - Actions: `reloadProvider`, `restartChannel`, `reindexMemory`

4. **Implement graceful restart** in `src/supervisor.ts`:
   - Before shutdown: persist all active tasks to disk
   - Exit with code 42 for restart request
   - On boot: detect restart (check `.ant/restart-pending`)
   - Resume pending tasks from checkpoint

5. **Add config API enhancements**:
   - `POST /api/config` with `{ changes, dryRun? }` → returns required actions
   - `POST /api/config/reload` → applies hot-reload changes
   - WhatsApp command: `/config set routing.chat lmstudio`

6. **Notify on config changes**:
   - WhatsApp: "🔧 Config updated: {summary}. {restart_required ? 'Restarting...' : 'Applied hot reload.'}"

**Verification**: Change a hot-reloadable config, verify applied without restart. Change a restart-required config, verify graceful restart and task resumption.

---

## Workstream 6: LM Studio Tool Call Parsing Fix

**Goal**: Fix the tool call parsing failure causing empty tool calls.

**Steps**:

1. **Analyze the error** from LM Studio logs:
   ```
   Failed to parse tool call: Unexpected end of content
   Model Output: <tool_call>memory_search<arg_key>query</arg_key><arg_value>Task 2</arg_value><arg_key>maxResults
   ```
   - The model output is truncated (incomplete XML)
   - This is likely a `max_tokens` issue or model context limit

2. **Add robust tool call parser** in new file `src/agent/tool-call-parser.ts`:
   - Handle incomplete XML gracefully
   - Attempt recovery: complete partial tags, extract what's parseable
   - Log warning but don't fail silently

3. **Add model-specific handling** for LM Studio models:
   - Some models use XML-style tool calls instead of OpenAI JSON
   - Create adapter in `src/agent/providers.ts` to normalize formats

4. **Increase context safety margins**:
   - Reserve tokens for tool call response (at least 500)
   - If response appears truncated, retry with higher max_tokens

5. **Add fallback on parse failure**:
   - If tool call parse fails, notify user: "Tool call parsing failed. Retrying with fallback provider..."
   - Emit error event for Main Agent to investigate

6. **Add LM Studio health monitoring**:
   - Check if model is loaded via `/v1/models`
   - Monitor for repeated parse failures
   - Auto-restart LM Studio if persistent issues (via `open_app` tool)

**Verification**: Send query that triggers `memory_search` tool, verify tool call parsed correctly or graceful degradation.

---

## Workstream 7: Autonomous Provider Discovery & Self-Survival

**Goal**: Main Agent researches and maintains a list of free/backup AI API providers (including local LLMs) to ensure the system never becomes unresponsive due to all providers failing.

**Steps**:

1. **Create Provider Discovery Duty** in `src/agent/duties/provider-discovery.ts`:
   - Research free AI APIs online from trustable sources:
     - OpenRouter free tier
     - Groq (free tier with limits)
     - Together AI (free trial)
     - Hugging Face Inference API (free)
     - Cloudflare Workers AI (free tier)
     - Google AI Studio (free tier, Gemini models)
     - Mistral AI (free tier)
     - Replicate (free credits)
     - DeepInfra (free tier)
     - Fireworks AI (free tier)
   - **Discover and configure local LLMs**:
     - Detect if LM Studio is installed (`/Applications/LM Studio.app` or via `lms` CLI)
     - Detect if Ollama is installed (`ollama list`)
     - Query available models from local providers
     - For local models, always prefer **fast/small models** (e.g., `llama-3.2-1b`, `qwen2.5-0.5b`, `phi-3-mini`, `gemma-2b`)
     - Auto-download recommended fast models if none available
   - Store discovered providers in memory (important category)
   - Update `ant.config.json` with new providers dynamically

2. **Create Local LLM Manager** in `src/agent/duties/local-llm-manager.ts`:
   - Detect local LLM runtimes (LM Studio, Ollama)
   - Query installed models: `ollama list`, LM Studio `/v1/models`
   - Maintain list of recommended fast models for backup:
     ```typescript
     const FAST_LOCAL_MODELS = {
       ollama: ['llama3.2:1b', 'qwen2.5:0.5b', 'phi3:mini', 'gemma2:2b'],
       lmstudio: ['lmstudio-community/Llama-3.2-1B-Instruct-GGUF', 'Qwen/Qwen2.5-0.5B-Instruct-GGUF']
     };
     ```
   - Auto-pull missing fast models: `ollama pull llama3.2:1b`
   - Load model into LM Studio if needed (via CLI or API)
   - Health check local endpoints: `http://localhost:11434` (Ollama), `http://localhost:1234` (LM Studio)

3. **Create Provider Health Monitor** in `src/agent/duties/provider-health.ts`:
   - Run periodic health checks on all backup providers (remote AND local)
   - Track success rate, latency, rate limits per provider
   - Maintain provider ranking by reliability
   - Remove providers that consistently fail
   - For local providers: check if runtime is running, model is loaded

4. **Extend config schema** in `src/config.ts`:
   ```typescript
   providers: {
     // User-configured providers
     items: Record<string, ProviderConfig>,
     // Auto-discovered backup providers
     discovered: Record<string, DiscoveredProviderConfig>,
     // Discovery settings
     discovery: {
       enabled: boolean,
       researchIntervalHours: number,  // How often to search for new providers
       healthCheckIntervalMinutes: number,  // How often to health check
       minBackupProviders: number,  // Target number of working backups
       trustSources: string[],  // URLs to check for free API lists
     },
     // Local LLM settings
     local: {
       enabled: boolean,
       preferFastModels: true,  // Always use fast models for local backups
       autoDownloadModels: boolean,  // Auto-pull recommended models
       ollama: {
         enabled: boolean,
         endpoint: string,  // default: http://localhost:11434
         fastModels: string[],  // e.g., ['llama3.2:1b', 'qwen2.5:0.5b']
       },
       lmstudio: {
         enabled: boolean,
         endpoint: string,  // default: http://localhost:1234
         fastModels: string[],  // e.g., ['Llama-3.2-1B-Instruct-GGUF']
       }
     }
   }
   ```

5. **Implement Dynamic Provider Registration** in `src/agent/providers.ts`:
   - `registerDiscoveredProvider(config)` - Add provider at runtime
   - `unregisterProvider(id)` - Remove failed provider
   - `getProvidersByReliability()` - Return sorted by success rate
   - Update fallback chain dynamically when providers added/removed

6. **Create Provider Research Template** in `src/agent/templates/provider-research.ts`:
   ```typescript
   const PROVIDER_RESEARCH_PROMPT = `
   Research current free AI API providers. For each, extract:
   - Provider name and URL
   - Base URL for API
   - Authentication method (API key, OAuth, none)
   - Models available
   - Rate limits
   - Pricing tier (free/freemium/trial)
   - Reliability reputation
   
   Trustable sources to check:
   - GitHub awesome-ai-apis lists
   - Official provider documentation
   - Developer community recommendations
   
   Return structured JSON with provider configs.
   `;
   ```

7. **Implement Self-Survival Mode** in `src/agent/main-agent.ts`:
   - When all configured providers fail:
     1. Attempt local providers first (Ollama/LM Studio with fast models)
     2. Attempt discovered remote backup providers
     3. If all backups fail, trigger emergency research task
     4. Use any working provider to research more providers
     5. Bootstrap recovery from minimal provider access
   - Add `survivalMode` flag to track degraded state
   - WhatsApp notification: "⚠️ All primary providers down. Running on backup: {provider}"

8. **Add Provider Priority Logic** in `src/routing/provider-priority.ts`:
   ```typescript
   function getPrioritizedProviders(action: string): Provider[] {
     const configured = getConfiguredProviders(action);
     const discovered = getDiscoveredProviders(action);
     const local = getLocalProviders(action);  // Ollama, LM Studio
     
     // Priority order:
     // 1. User's preferred provider (from config)
     // 2. Healthy configured providers (sorted by success rate)
     // 3. Healthy local providers (fast models only, zero network latency)
     // 4. Healthy discovered remote providers (sorted by reliability score)
     // 5. Degraded providers (as last resort)
     
     return [
       ...configured.filter(p => p.health === 'healthy'),
       ...local.filter(p => p.health === 'healthy' && p.isFastModel),
       ...discovered.filter(p => p.health === 'healthy'),
       ...local.filter(p => p.health === 'degraded'),
       ...configured.filter(p => p.health === 'degraded'),
       ...discovered.filter(p => p.health === 'degraded'),
     ];
   }
   ```

9. **Add Discovery Scheduler** to Main Agent duties:
   - Run provider research every 24 hours (configurable)
   - Run health checks every 15 minutes (configurable)
   - Save all provider metadata to memory for persistence
   - Log all provider changes to AGENT_LOG.md

10. **Create Provider Config Writer** in `src/config/provider-writer.ts`:
    - Safely update `ant.config.json` with discovered providers
    - Backup config before changes
    - Validate provider config before writing
    - Trigger hot-reload after config update

11. **Implement Provider Verification** before adding:
    - Test API key/access (if required)
    - Test basic chat completion
    - Measure response latency
    - Verify model availability
    - Score reliability (0-100)
    - For local providers: verify runtime is running and model is loaded

**Verification**: 
1. Disable all configured providers
2. Verify Main Agent detects Ollama/LM Studio if installed
3. Verify fast models are auto-downloaded if missing
4. Verify Main Agent discovers remote backup providers
5. Verify system continues operating on local backups first
6. If local unavailable, verify fallback to remote discovered providers
7. Re-enable primary providers, verify priority restored

**Known Free Provider Sources** (to be researched programmatically):

| Provider | Free Tier | Rate Limit | Quality | Type |
|----------|-----------|------------|---------|------|
| Ollama (local) | Yes | Unlimited | Varies | Local |
| LM Studio (local) | Yes | Unlimited | Varies | Local |
| OpenRouter | Yes | 20 req/min | High | Remote |
| Groq | Yes | 30 req/min | High | Remote |
| Together AI | Trial | 60 req/min | High | Remote |
| HuggingFace | Yes | 1000/day | Medium | Remote |
| Cloudflare AI | Yes | 10k/day | Medium | Remote |
| Google AI Studio | Yes | 60/min | High | Remote |
| Mistral | Yes | Limited | High | Remote |
| DeepInfra | Trial | Varies | High | Remote |
| Cohere | Trial | 1000/mo | Medium | Remote |

**Recommended Fast Local Models** (for backup tier):

| Runtime | Model | Size | Speed | Use Case |
|---------|-------|------|-------|----------|
| Ollama | `llama3.2:1b` | 1.3GB | Very Fast | General backup |
| Ollama | `qwen2.5:0.5b` | 400MB | Fastest | Quick responses |
| Ollama | `phi3:mini` | 2.3GB | Fast | Reasoning backup |
| Ollama | `gemma2:2b` | 1.6GB | Fast | General backup |
| LM Studio | `Llama-3.2-1B-Instruct-GGUF` | 1.3GB | Very Fast | General backup |
| LM Studio | `Qwen2.5-0.5B-Instruct-GGUF` | 400MB | Fastest | Quick responses |

---

## Workstream 8: Watchdog Ant (Lightweight Supervisor)

**Goal**: A minimal, crash-resistant process that monitors the main ant-cli and ensures it stays running. The watchdog has a fixed, hardcoded purpose - no dynamic prompts, no complex logic.

**Concept**: Two-instance architecture:
- **Watchdog Ant** (ant-lite): Minimal supervisor, fixed behavior, monitors main ant
- **Main Ant**: Full-featured agent with all workstreams

**Steps**:

1. **Create Watchdog Entry Point** in `src/watchdog/index.ts`:
   ```typescript
   // Minimal dependencies: only node built-ins + basic HTTP
   // NO LLM calls, NO complex logic, NO dynamic behavior
   
   const WATCHDOG_CONFIG = {
     mainAntHealthUrl: 'http://127.0.0.1:5117/api/health',
     healthCheckIntervalMs: 10_000,  // Check every 10s
     maxConsecutiveFailures: 3,       // Restart after 3 failures
     restartCooldownMs: 30_000,       // Wait 30s between restarts
     mainAntStartCommand: 'node dist/cli.js run -c ant.config.json',
   };
   ```

2. **Implement Health Check Loop**:
   ```typescript
   async function checkMainAntHealth(): Promise<boolean> {
     try {
       const res = await fetch(WATCHDOG_CONFIG.mainAntHealthUrl, { 
         timeout: 5000 
       });
       return res.ok;
     } catch {
       return false;
     }
   }
   
   async function watchdogLoop() {
     let failures = 0;
     while (true) {
       const healthy = await checkMainAntHealth();
       if (healthy) {
         failures = 0;
       } else {
         failures++;
         log(`Main ant unhealthy (${failures}/${WATCHDOG_CONFIG.maxConsecutiveFailures})`);
         if (failures >= WATCHDOG_CONFIG.maxConsecutiveFailures) {
           await restartMainAnt();
           failures = 0;
           await sleep(WATCHDOG_CONFIG.restartCooldownMs);
         }
       }
       await sleep(WATCHDOG_CONFIG.healthCheckIntervalMs);
     }
   }
   ```

3. **Implement Process Management**:
   ```typescript
   let mainAntProcess: ChildProcess | null = null;
   
   async function restartMainAnt() {
     log('Killing main ant...');
     if (mainAntProcess) {
       mainAntProcess.kill('SIGTERM');
       await sleep(5000);
       if (!mainAntProcess.killed) {
         mainAntProcess.kill('SIGKILL');
       }
     }
     
     log('Starting main ant...');
     mainAntProcess = spawn('node', ['dist/cli.js', 'run', '-c', 'ant.config.json'], {
       cwd: process.cwd(),
       stdio: 'inherit',
       detached: false,
     });
     
     mainAntProcess.on('exit', (code) => {
       log(`Main ant exited with code ${code}`);
       mainAntProcess = null;
     });
   }
   ```

4. **Add Minimal Notification** (optional, hardcoded):
   - If WhatsApp is configured, send fixed message on restart: "🔄 Main ant restarted by watchdog"
   - Use bare HTTP POST to WhatsApp gateway (no Baileys dependency)

5. **Create Watchdog CLI Command**:
   ```bash
   # Start watchdog (which starts and monitors main ant)
   npm run watchdog
   # or
   node dist/watchdog/index.js
   ```

6. **Implement Watchdog Self-Healing**:
   - Watchdog itself should be started by systemd/launchd/pm2
   - Watchdog has NO external dependencies that can fail
   - Watchdog never makes LLM calls
   - Watchdog writes to simple log file for debugging

7. **Add Health Endpoint to Main Ant** in `src/gateway/server.ts`:
   ```typescript
   app.get('/api/health', (req, res) => {
     const health = {
       status: 'ok',
       uptime: process.uptime(),
       memoryUsage: process.memoryUsage(),
       lastActivity: Date.now() - lastActivityTimestamp,
       providers: getProviderHealthSummary(),
     };
     res.json(health);
   });
   ```

8. **Implement Activity Monitoring**:
   - Track `lastActivityTimestamp` in main ant
   - If no activity for > 5 minutes AND queue is empty, mark as "idle" (not unhealthy)
   - If no activity for > 5 minutes AND queue has items, mark as "stuck" → trigger restart

9. **Add Crash Recovery State Persistence**:
   - Before watchdog kills main ant, signal it to dump state to `.ant/crash-state.json`
   - Main ant loads crash state on boot and resumes pending tasks
   - Include: active session, pending queue items, current task progress

10. **Create Deployment Configuration**:
    ```bash
    # macOS launchd plist for watchdog
    # ~/Library/LaunchAgents/com.ant.watchdog.plist
    
    # Linux systemd service
    # /etc/systemd/system/ant-watchdog.service
    ```

**Watchdog Guarantees**:
- **Minimal footprint**: < 50KB of code, < 20MB RAM
- **No external dependencies**: Only Node.js built-ins
- **Fixed behavior**: No config files, no LLM calls, no dynamic prompts
- **Fast startup**: < 1 second to be monitoring
- **Crash resistant**: Even if main ant corrupts state, watchdog unaffected

**Architecture Diagram**:
```
┌─────────────────────────────────────────────────────────┐
│  System Service (launchd/systemd/pm2)                   │
│  └─> Restarts watchdog if it crashes                    │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│  Watchdog Ant (ant-lite)                                │
│  - 10s health check loop                                │
│  - Kill + restart main ant on failure                   │
│  - Simple log file output                               │
│  - NO LLM, NO complex deps                              │
└─────────────────────┬───────────────────────────────────┘
                      │ spawns & monitors
┌─────────────────────▼───────────────────────────────────┐
│  Main Ant (full agent)                                  │
│  - All 7 workstreams                                    │
│  - LLM providers, WhatsApp, Memory, UI                  │
│  - Exposes /api/health for watchdog                     │
└─────────────────────────────────────────────────────────┘
```

**Verification**:
1. Start watchdog, verify main ant starts automatically
2. Kill main ant process, verify watchdog restarts it within 30s
3. Make main ant hang (infinite loop), verify watchdog detects and restarts
4. Corrupt main ant config, verify watchdog continues monitoring
5. Kill watchdog, verify system service restarts it

---

## Workstream 9: Production Ready & Docker Support

**Goal**: Make ant-cli production-ready with Docker containerization, proper logging, graceful shutdown, and deployment best practices.

**Steps**:

1. **Create Production Dockerfile** in `Dockerfile.prod`:
   ```dockerfile
   # Multi-stage build for minimal image size
   FROM node:20-alpine AS builder
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --only=production
   COPY . .
   RUN npm run build
   
   FROM node:20-alpine AS runtime
   WORKDIR /app
   
   # Install minimal runtime deps
   RUN apk add --no-cache tini
   
   # Copy built artifacts
   COPY --from=builder /app/dist ./dist
   COPY --from=builder /app/node_modules ./node_modules
   COPY --from=builder /app/package.json ./
   
   # Create non-root user
   RUN addgroup -g 1001 ant && adduser -u 1001 -G ant -s /bin/sh -D ant
   RUN mkdir -p /app/.ant && chown -R ant:ant /app
   USER ant
   
   # Health check
   HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
     CMD wget -q --spider http://localhost:5117/api/health || exit 1
   
   # Use tini for proper signal handling
   ENTRYPOINT ["/sbin/tini", "--"]
   CMD ["node", "dist/cli.js", "run", "-c", "ant.config.json"]
   ```

2. **Create Docker Compose Configuration** in `docker-compose.yml`:
   ```yaml
   version: '3.8'
   
   services:
     ant:
       build:
         context: .
         dockerfile: Dockerfile.prod
       container_name: ant-main
       restart: unless-stopped
       ports:
         - "5117:5117"
       volumes:
         - ./ant.config.json:/app/ant.config.json:ro
         - ant-data:/app/.ant
         - ${HOME}:/home/user:ro  # Optional: mount home for file access
       environment:
         - NODE_ENV=production
         - ANT_LOG_LEVEL=info
       depends_on:
         - ollama  # Optional: local LLM
       networks:
         - ant-network
       healthcheck:
         test: ["CMD", "wget", "-q", "--spider", "http://localhost:5117/api/health"]
         interval: 30s
         timeout: 10s
         retries: 3
         start_period: 60s
   
     watchdog:
       build:
         context: .
         dockerfile: Dockerfile.watchdog
       container_name: ant-watchdog
       restart: always
       environment:
         - MAIN_ANT_HEALTH_URL=http://ant:5117/api/health
         - MAIN_ANT_CONTAINER=ant-main
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock:ro
       networks:
         - ant-network
       depends_on:
         - ant
   
     ollama:
       image: ollama/ollama:latest
       container_name: ant-ollama
       restart: unless-stopped
       volumes:
         - ollama-models:/root/.ollama
       ports:
         - "11434:11434"
       networks:
         - ant-network
       # GPU support (uncomment for NVIDIA)
       # deploy:
       #   resources:
       #     reservations:
       #       devices:
       #         - capabilities: [gpu]
   
   volumes:
     ant-data:
     ollama-models:
   
   networks:
     ant-network:
       driver: bridge
   ```

3. **Create Watchdog Dockerfile** in `Dockerfile.watchdog`:
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   
   # Install docker CLI for container management
   RUN apk add --no-cache docker-cli tini
   
   COPY src/watchdog ./src/watchdog
   COPY package*.json ./
   RUN npm ci --only=production --ignore-scripts
   
   RUN addgroup -g 1001 ant && adduser -u 1001 -G ant -s /bin/sh -D ant
   USER ant
   
   ENTRYPOINT ["/sbin/tini", "--"]
   CMD ["node", "src/watchdog/index.js"]
   ```

4. **Implement Graceful Shutdown** in `src/cli.ts`:
   ```typescript
   // Handle SIGTERM/SIGINT for Docker stop
   const shutdown = async (signal: string) => {
     logger.info({ signal }, 'Received shutdown signal');
     
     // 1. Stop accepting new messages
     await whatsapp.disconnect();
     
     // 2. Wait for in-flight tasks (max 30s)
     await queue.drain(30_000);
     
     // 3. Persist state
     await persistCrashState();
     
     // 4. Close connections
     await memory.close();
     await gateway.close();
     
     logger.info('Graceful shutdown complete');
     process.exit(0);
   };
   
   process.on('SIGTERM', () => shutdown('SIGTERM'));
   process.on('SIGINT', () => shutdown('SIGINT'));
   ```

5. **Add Environment Variable Configuration**:
   ```typescript
   // Support config via environment variables
   const envConfig = {
     ANT_CONFIG_PATH: process.env.ANT_CONFIG_PATH || 'ant.config.json',
     ANT_LOG_LEVEL: process.env.ANT_LOG_LEVEL || 'info',
     ANT_STATE_DIR: process.env.ANT_STATE_DIR || '.ant',
     ANT_GATEWAY_PORT: parseInt(process.env.ANT_GATEWAY_PORT || '5117'),
     ANT_WHATSAPP_ENABLED: process.env.ANT_WHATSAPP_ENABLED !== 'false',
   };
   ```

6. **Create Production Health Checks** in `src/gateway/server.ts`:
   ```typescript
   // Kubernetes/Docker compatible health endpoints
   app.get('/health', (req, res) => res.send('OK'));  // Liveness
   
   app.get('/ready', async (req, res) => {  // Readiness
     const checks = {
       whatsapp: await whatsapp.isConnected(),
       memory: await memory.isReady(),
       providers: await providers.hasHealthyProvider(),
     };
     const allReady = Object.values(checks).every(Boolean);
     res.status(allReady ? 200 : 503).json(checks);
   });
   
   app.get('/api/health', async (req, res) => {  // Detailed health
     res.json({
       status: 'ok',
       version: pkg.version,
       uptime: process.uptime(),
       memory: process.memoryUsage(),
       lastActivity: Date.now() - lastActivityTimestamp,
       providers: await getProviderHealthSummary(),
       queue: queue.getStats(),
     });
   });
   ```

7. **Add Structured Logging for Production**:
   ```typescript
   // JSON logging for log aggregators (ELK, CloudWatch, etc.)
   const logger = pino({
     level: process.env.ANT_LOG_LEVEL || 'info',
     formatters: {
       level: (label) => ({ level: label }),
     },
     timestamp: pino.stdTimeFunctions.isoTime,
     base: {
       service: 'ant-cli',
       version: pkg.version,
       instance: process.env.HOSTNAME || 'local',
     },
   });
   ```

8. **Create Production Configuration Template** in `ant.config.prod.json`:
   ```json
   {
     "gateway": {
       "port": 5117,
       "host": "0.0.0.0"
     },
     "logging": {
       "level": "info",
       "fileLevel": "debug",
       "filePath": "/app/.ant/logs/ant.log"
     },
     "providers": {
       "local": {
         "enabled": true,
         "ollama": {
           "enabled": true,
           "endpoint": "http://ollama:11434"
         }
       }
     },
     "memory": {
       "enabled": true,
       "sync": {
         "onSessionStart": true,
         "watch": false
       }
     }
   }
   ```

9. **Add Docker Build Scripts** to `package.json`:
   ```json
   {
     "scripts": {
       "docker:build": "docker build -t ant-cli:latest -f Dockerfile.prod .",
       "docker:build:watchdog": "docker build -t ant-watchdog:latest -f Dockerfile.watchdog .",
       "docker:up": "docker-compose up -d",
       "docker:down": "docker-compose down",
       "docker:logs": "docker-compose logs -f",
       "docker:restart": "docker-compose restart ant",
       "docker:shell": "docker-compose exec ant sh"
     }
   }
   ```

10. **Create Kubernetes Deployment** (optional) in `k8s/deployment.yaml`:
    ```yaml
    apiVersion: apps/v1
    kind: Deployment
    metadata:
      name: ant-cli
    spec:
      replicas: 1
      selector:
        matchLabels:
          app: ant-cli
      template:
        metadata:
          labels:
            app: ant-cli
        spec:
          containers:
          - name: ant
            image: ant-cli:latest
            ports:
            - containerPort: 5117
            livenessProbe:
              httpGet:
                path: /health
                port: 5117
              initialDelaySeconds: 30
              periodSeconds: 10
            readinessProbe:
              httpGet:
                path: /ready
                port: 5117
              initialDelaySeconds: 10
              periodSeconds: 5
            resources:
              requests:
                memory: "256Mi"
                cpu: "100m"
              limits:
                memory: "1Gi"
                cpu: "500m"
            volumeMounts:
            - name: config
              mountPath: /app/ant.config.json
              subPath: ant.config.json
            - name: data
              mountPath: /app/.ant
          volumes:
          - name: config
            configMap:
              name: ant-config
          - name: data
            persistentVolumeClaim:
              claimName: ant-data
    ```

11. **Add Security Hardening**:
    - Run as non-root user in containers
    - Read-only root filesystem where possible
    - Minimal base image (Alpine)
    - No shell access in production image
    - Secrets via environment variables or mounted files

12. **Create CI/CD Pipeline** (GitHub Actions) in `.github/workflows/docker.yml`:
    ```yaml
    name: Docker Build & Push
    
    on:
      push:
        branches: [main]
        tags: ['v*']
    
    jobs:
      build:
        runs-on: ubuntu-latest
        steps:
        - uses: actions/checkout@v4
        
        - name: Build and test
          run: |
            npm ci
            npm run build
            npm test
        
        - name: Build Docker image
          run: docker build -t ant-cli:${{ github.sha }} -f Dockerfile.prod .
        
        - name: Push to registry
          if: github.ref == 'refs/heads/main'
          run: |
            echo ${{ secrets.DOCKER_PASSWORD }} | docker login -u ${{ secrets.DOCKER_USERNAME }} --password-stdin
            docker tag ant-cli:${{ github.sha }} ${{ secrets.DOCKER_REGISTRY }}/ant-cli:latest
            docker push ${{ secrets.DOCKER_REGISTRY }}/ant-cli:latest
    ```

**Verification**:
1. Build Docker image: `npm run docker:build`
2. Start with docker-compose: `npm run docker:up`
3. Verify health endpoint: `curl http://localhost:5117/api/health`
4. Send WhatsApp message, verify response
5. Stop container gracefully: `docker-compose stop ant`
6. Verify state persisted and restored on restart
7. Test watchdog: `docker kill ant-main`, verify auto-restart

**Production Checklist**:
- [ ] Environment-based configuration
- [ ] Structured JSON logging
- [ ] Graceful shutdown handling
- [ ] Health check endpoints (liveness + readiness)
- [ ] Non-root container user
- [ ] Resource limits defined
- [ ] Persistent volume for state
- [ ] Secrets management
- [ ] Backup strategy for `.ant/` directory
- [ ] Monitoring/alerting integration
- [ ] Log aggregation setup

---

## Implementation Priority & Dependencies

```
Phase 1 (Parallel):
├── WS1: Tiered Provider Routing ─────────────┐
├── WS3: Memory Categorization ───────────────┼── Independent
├── WS6: LM Studio Fix ───────────────────────┤
├── WS8: Watchdog Ant ────────────────────────┤  (Independent, minimal deps)
├── WS9: Production Ready & Docker ───────────┘  (Independent, infrastructure)
│
Phase 2 (Depends on Phase 1):
├── WS4: Queen Ant Orchestration (needs WS1 for failover, WS3 for memory)
├── WS5: Hot-Reload Config (needs WS1 for provider changes)
├── WS7: Provider Discovery (needs WS1 for routing, WS4 for Main Agent duties)
│
Phase 3 (Depends on all):
└── WS2: UI Overhaul (integrates all workstreams' data)
```

---

## Suggested Addition: Provider Intelligence Tiers

Based on your ask for suggestions, here's tier 6:

**6. Intelligence Router** - Automatic task complexity analysis:
- **Simple**: Direct answers, lookups, file operations → Fast tier
- **Moderate**: Multi-step tasks, code generation → Quality tier  
- **Complex**: Reasoning, debugging, analysis → Quality tier with extended thinking
- **Autonomous**: Background maintenance, investigations → Background tier with long timeout
- **Batch**: Embeddings, summarization → Batch-optimized tier

Implementation: Add intent classifier that uses simple heuristics + optional LLM quick-check to route appropriately.

---

## Decisions Made

- **Memory persistence**: SQLite with new columns (vs. separate priority table) for simplicity
- **Hot-reload approach**: Granular rules per config path (vs. full restart approach) for better UX
- **UI framework**: Keep React + Tailwind, add streaming components
- **Investigation pattern**: Subagent model (vs. inline handling) for parallelism and isolation
- **Notification channel**: WhatsApp only (vs. multi-channel) since it's the primary interface
- **Provider discovery**: Auto-research free APIs online, store in `discovered` section of config (separate from user-configured)
- **Provider priority**: User-configured providers always take precedence over discovered; within each tier, sort by health/reliability score
- **Self-survival mode**: When all providers fail, use any working discovered provider to continue operating and research more backups
- **Local LLM backup**: Prefer local providers (Ollama/LM Studio) over remote discovered providers for lower latency and zero network dependency
- **Fast models only for backup**: Local backup models must be fast (<3B params) to ensure quick responses; avoid large models that would slow down the system
- **Auto-download models**: If local LLM runtime is detected but no fast models are available, automatically pull recommended models
- **Watchdog architecture**: Two-instance model with minimal watchdog (ant-lite) supervising main ant; watchdog has zero LLM dependencies
- **Watchdog deployment**: System service (launchd/systemd/pm2) manages watchdog; watchdog manages main ant
- **Crash state persistence**: Main ant dumps state before crash, loads on restart to resume pending work
- **Docker deployment**: Multi-stage build for minimal image, docker-compose with watchdog + ollama, Kubernetes manifests for cloud deployment
- **Production logging**: Structured JSON logs compatible with ELK/CloudWatch/Datadog
- **Graceful shutdown**: Proper SIGTERM handling, drain queue, persist state before exit

---

## OpenClaw Patterns to Adopt (Deep Dive Insights)

After thorough study of `/Users/a/Projects/openclaw`, here are additional production-grade patterns to incorporate:

### 1. Memory System Enhancements (from `src/memory/manager.ts`)

**Embedding Cache with Hash Deduplication**:
```typescript
// OpenClaw pattern: Cache embeddings by content hash
const cached = this.loadEmbeddingCache(chunks.map(c => c.hash));
// Skip embedding generation if hash matches
```

**Batch Embedding with Provider Fallback**:
```typescript
// OpenClaw supports OpenAI and Gemini batch APIs with automatic fallback
async activateFallbackProvider(reason: string): Promise<boolean> {
  // Switch from failed provider to fallback, recompute providerKey
  // Trigger full reindex with new provider
}
```

**Delta-Based Session Sync**:
- Track `pendingBytes` and `pendingMessages` per session file
- Only reindex when thresholds exceeded (`sessionsDeltaBytes`, `sessionsDeltaMessages`)
- Count newlines efficiently for message delta detection

**Progress Reporting Pattern**:
```typescript
type MemorySyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};
// Pass progress callback through all sync operations
```

### 2. Config Hot-Reload System (from `src/gateway/config-reload.ts`)

**Reload Rule Architecture**:
```typescript
type ReloadRule = {
  prefix: string;          // e.g., "hooks.gmail"
  kind: "restart" | "hot" | "none";
  actions?: ReloadAction[];  // e.g., ["restart-gmail-watcher"]
};

// Build reload plan from changed paths
function buildGatewayReloadPlan(changedPaths: string[]): GatewayReloadPlan {
  // Returns: restartGateway, restartReasons, hotReasons, 
  // reloadHooks, restartChannels, noopPaths
}
```

**Config Diff Detection**:
```typescript
export function diffConfigPaths(prev: unknown, next: unknown, prefix = ""): string[] {
  // Recursively compare objects, return changed paths
}
```

**Debounced Watcher with Validation**:
```typescript
const watcher = chokidar.watch(opts.watchPath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
});
// Validate config before applying changes
```

### 3. Command Queue with Lanes (from `src/process/command-queue.ts`)

**Lane-Based Concurrency**:
```typescript
type LaneState = {
  lane: string;
  queue: QueueEntry[];
  active: number;
  maxConcurrent: number;
  draining: boolean;
};

// Different lanes for different workloads
export const CommandLane = {
  Main: "main",
  Cron: "cron", 
  Subagent: "subagent",
  Nested: "nested",
};
```

**Wait Time Warnings**:
```typescript
if (waitedMs >= entry.warnAfterMs) {
  entry.onWait?.(waitedMs, state.queue.length);
  diag.warn(`lane wait exceeded: lane=${lane} waitedMs=${waitedMs}`);
}
```

### 4. Tool Stream UI Pattern (from `ui/src/ui/app-tool-stream.ts`)

**Tool Stream State**:
```typescript
type ToolStreamEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
  updatedAt: number;
  message: Record<string, unknown>;
};

// Limit stream to 50 entries, throttle UI sync to 80ms
const TOOL_STREAM_LIMIT = 50;
const TOOL_STREAM_THROTTLE_MS = 80;
```

**Compaction Status Toast**:
```typescript
type CompactionStatus = {
  active: boolean;
  startedAt: number | null;
  completedAt: number | null;
};
// Auto-dismiss toast after 5s
```

### 5. Subagent Registry (from `src/agents/subagent-registry.ts`)

**Persistent Registry with Resume**:
```typescript
// Restore subagent runs on restart
function restoreSubagentRunsOnce() {
  const restored = loadSubagentRegistryFromDisk();
  // Resume pending work
  for (const runId of subagentRuns.keys()) {
    resumeSubagentRun(runId);
  }
}
```

**Lifecycle Event Listener**:
```typescript
onAgentEvent((evt) => {
  if (evt.stream !== "lifecycle") return;
  const phase = evt.data?.phase;
  if (phase === "end" || phase === "error") {
    // Trigger announce flow + cleanup
  }
});
```

**Archive Sweeper**:
```typescript
// Periodically clean up old subagent runs
sweeper = setInterval(() => void sweepSubagentRuns(), 60_000);
// Delete after archiveAfterMinutes
```

### 6. Status Formatting (from `src/memory/status-format.ts`)

**Consistent Tone System**:
```typescript
type Tone = "ok" | "warn" | "muted";

function resolveMemoryVectorState(vector): { tone: Tone; state: string } {
  if (!vector.enabled) return { tone: "muted", state: "disabled" };
  if (vector.available) return { tone: "ok", state: "ready" };
  return { tone: "warn", state: "unavailable" };
}
```

### 7. App View State (from `ui/src/ui/app-view-state.ts`)

**Comprehensive UI State Model**:
- Separate loading flags per module (`cronLoading`, `skillsLoading`, `agentsLoading`)
- Error states per module (`channelsError`, `sessionsError`)
- Queue state management (`chatQueue: ChatQueueItem[]`)
- Form state tracking with dirty detection
- Handler methods for all UI actions

### 8. Failover Error Classification (from `src/agents/failover-error.ts`)

**Structured Error with Context**:
```typescript
class FailoverError extends Error {
  readonly reason: FailoverReason;  // billing, rate_limit, auth, timeout, format
  readonly provider?: string;
  readonly model?: string;
  readonly profileId?: string;
  readonly status?: number;
  readonly code?: string;
}
```

---

## Files to Create

| File | Workstream | Description |
|------|------------|-------------|
| `src/routing/tier-resolver.ts` | WS1 | Intent analysis and tier selection |
| `src/agent/task/execution-tracker.ts` | WS2 | Real-time task state tracking |
| `ui/src/pages/TaskDetail.tsx` | WS2 | Task drill-down view |
| `src/memory/types.ts` | WS3 | Memory category definitions |
| `src/memory/categorizer.ts` | WS3 | Auto-categorization logic |
| `src/memory/pruner.ts` | WS3 | Intelligent memory pruning |
| `src/agent/templates/investigation.ts` | WS4 | Investigation subagent template |
| `src/config/watcher.ts` | WS5 | Config file watcher |
| `src/config/reload-rules.ts` | WS5 | Hot-reload rule definitions |
| `src/agent/tool-call-parser.ts` | WS6 | Robust tool call parsing |
| `src/agent/duties/provider-discovery.ts` | WS7 | Free API research and discovery |
| `src/agent/duties/provider-health.ts` | WS7 | Backup provider health monitoring |
| `src/agent/duties/local-llm-manager.ts` | WS7 | Local LLM detection and fast model management |
| `src/agent/templates/provider-research.ts` | WS7 | Research prompt template |
| `src/routing/provider-priority.ts` | WS7 | Dynamic provider prioritization |
| `src/config/provider-writer.ts` | WS7 | Safe config updates for discovered providers |
| `src/watchdog/index.ts` | WS8 | Lightweight supervisor entry point |
| `src/watchdog/health-check.ts` | WS8 | Main ant health check logic |
| `src/watchdog/process-manager.ts` | WS8 | Kill/restart main ant process |
| `Dockerfile.prod` | WS9 | Production multi-stage Docker build |
| `Dockerfile.watchdog` | WS9 | Minimal watchdog container |
| `docker-compose.yml` | WS9 | Full stack deployment config |
| `ant.config.prod.json` | WS9 | Production configuration template |
| `k8s/deployment.yaml` | WS9 | Kubernetes deployment manifests |
| `.github/workflows/docker.yml` | WS9 | CI/CD pipeline for Docker builds |

## Files to Modify

| File | Workstream | Changes |
|------|------------|---------|
| `src/config.ts` | WS1, WS7 | Add tiered routing schema, discovery config |
| `src/agent/providers.ts` | WS1, WS6, WS7 | Add failover callback, model adapters, dynamic registration |
| `src/agent/engine.ts` | WS1, WS2 | Failover events, execution tracking |
| `ui/src/pages/RoyalChamber.tsx` | WS2, WS7 | Task panel, provider dashboard, backup provider status |
| `ui/src/pages/ArchiveChambers.tsx` | WS3 | Memory browser with categories |
| `src/memory/manager.ts` | WS3 | Schema migration, category columns |
| `src/agent/main-agent.ts` | WS4, WS7 | Error scanning, investigation spawning, provider discovery duty |
| `src/agent/task/task-store.ts` | WS4 | Checkpoint persistence |
| `src/supervisor.ts` | WS5 | Graceful restart with resume |
| `ant.config.json` | WS7 | Add discovered providers section (auto-managed) |
| `src/gateway/server.ts` | WS2, WS7, WS8, WS9 | New WebSocket event types, provider status API, health endpoint, production health checks |
| `package.json` | WS8, WS9 | Add watchdog script, Docker build scripts |
| `src/cli.ts` | WS9 | Graceful shutdown handling, env var config |
| `src/log.ts` | WS9 | Structured JSON logging for production |

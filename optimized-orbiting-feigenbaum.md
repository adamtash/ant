# Comprehensive Plan: Fix Ant System Using OpenClaw Patterns

**Plan Status**: DETAILED IMPLEMENTATION ROADMAP
**Last Updated**: 2026-02-02
**Target Completion**: Multi-phase, self-referential loop with checkpoint validation

---

## EXECUTIVE SUMMARY

The ant system has solid foundations (agent engine, event system, tool registry) but lacks the sophisticated multi-agent orchestration architecture that makes OpenClaw effective. This plan systematically applies OpenClaw's proven patterns to fix ant's three critical issues:

1. **Status updates not propagating**: Replace snapshot-based broadcasting with event-sourced delta streams
2. **Sub-agent management broken**: Implement lane-based concurrency with hierarchical task tracking
3. **Task orchestration missing**: Build formal task state machine with persistence and status hierarchy

**Key Insight**: OpenClaw solves these with: (1) Session-key-based identity routing, (2) Lane-based concurrency, (3) Event streams with structured metadata, (4) Configuration-driven behavior cascades, (5) Persistent state with cache invalidation.

---

## PHASE 1: ASSESSMENT & FOUNDATIONS (DETAILED)

### 1.1 Critical Files to Understand

**Ant Current State (Already Analyzed)**:
- `src/agent/main-agent.ts` - Task management flawed, no persistence
- `src/gateway/server.ts` - Status broadcasting is snapshot-based
- `src/monitor/event-stream.ts` - Event infrastructure exists but disconnected from tasks
- `src/agent/engine.ts` - Tool loop works, provider failover solid
- `src/agent/providers.ts` - Provider routing sophisticated

**OpenClaw Patterns to Import**:
- `src/config/sessions/store.ts` - Multi-layered state tracking with TTL caching
- `src/infra/agent-events.ts` - Event infrastructure with metadata tracking
- `src/process/command-queue.ts` - Lane-based concurrency model
- `src/routing/session-key.ts` - Agent ID normalization and routing
- `src/agents/pi-embedded-runner/` - Sub-agent execution model with state management
- `src/agents/tools/sessions-spawn-tool.ts` - Sub-agent spawning with isolation

### 1.2 Key OpenClaw Patterns Needed in Ant

| Pattern | OpenClaw Implementation | Required in Ant | Severity |
|---------|------------------------|-----------------|----------|
| **Lane-based Concurrency** | `src/process/lanes.ts`, CommandLane enum | Sub-agent parallel execution | CRITICAL |
| **Event Metadata** | SessionKey, run IDs, verbose level tracking | Task ID linked to events | CRITICAL |
| **State Caching** | 45-second TTL with file mtime invalidation | Task state cache | HIGH |
| **Session Key Format** | `agent:id:key` or `subagent:id:key` | Task session routing | CRITICAL |
| **Configuration Cascades** | Global → agent → session → runtime | Task execution defaults | HIGH |
| **Persistent Job Registry** | File-based task store with JSON | Replace Map-based task storage | CRITICAL |
| **Hierarchical Status** | Parent/child relationships with status rollup | Track sub-agent progress | CRITICAL |
| **Delta Event Streams** | Event types for each state change | Replace snapshot broadcasting | CRITICAL |

### 1.3 Gap Analysis: Ant vs OpenClaw

**OpenClaw Strengths Ant Lacks**:
1. ❌ **Multi-tenancy by design**: Ant has one main agent; OpenClaw supports N agents
2. ❌ **Persistent task registry**: Ant uses in-memory Map; OpenClaw uses file-based store with caching
3. ❌ **Event-sourced status**: Ant broadcasts snapshots every 1s; OpenClaw emits delta events
4. ❌ **Hierarchical status rollup**: Ant has flat status; OpenClaw tracks parent/child chains
5. ❌ **Lane-based concurrency**: Ant executes tasks sequentially; OpenClaw has Main/Cron/Subagent/Nested lanes
6. ❌ **Configuration cascades**: Ant has global config only; OpenClaw supports agent-level overrides
7. ❌ **Session-scoped tool results**: Ant's tool results global; OpenClaw guards per-session

---

## PHASE 1.5: ADVANCED OPENCLAW TECHNICAL PATTERNS (DEEP DIVE)

This section documents critical technical patterns from OpenClaw that directly solve ant's problems.

### **1.5.1 Embedded PI Runner Pattern (Async Agent Execution)**

OpenClaw's embedded runner enables **true parallel sub-agent execution** unlike ant's sequential model:

**Core State Machine** (`src/agents/pi-embedded-runner/run.ts`):
```
┌─ PENDING: Waiting for execution slot
├─ RUNNING: Agent processing (streaming responses)
├─ COMPLETED: Result ready
└─ FAILED: Error occurred
```

**Active Run Tracking** (Critical for ant):
```typescript
// ACTIVE_EMBEDDED_RUNS: Map<sessionId, EmbeddedPiQueueHandle>
// Enables:
// - Non-blocking sub-agent spawning
// - Multiple concurrent runs per session
// - Result streaming to parent agent
```

**Why ant needs this**: Currently main agent blocks waiting for sub-agent completion. With embedded runner pattern:
1. Main agent spawns sub-task → returns immediately
2. Sub-agent runs in background (in Autonomous lane)
3. Main agent continues with other work
4. Results delivered via event stream (not polling)

**Message Payload Construction** (OpenClaw pattern for ant to adopt):
```typescript
// Each run gets message history snapshot
interface RunPayload {
  type: "agent_run"
  runId: string
  iteration: number
  messages: Message[]       // ← Include full history
  toolDefinitions: Tool[]   // ← Available tools
  metadata: {
    sessionKey: string
    maxIterations: number
    timeoutMs: number
    phase: "planning" | "executing" | "verifying"
  }
}
```

**Session Compaction Strategy** (OpenClaw's aggressive approach):
```
Compaction triggered at 3 checkpoints:

1. Iteration start (75% threshold):
   - Keep system message
   - Keep last 8 messages
   - Summarize older messages

2. Context threshold (50% full):
   - Emergency compaction
   - Aggressive removal of old messages

3. Mid-loop (60% full):
   - After tool execution
   - Prevent overflow mid-iteration
```

Ant needs: Implement same 3-checkpoint strategy to prevent context window overflow during long tasks.

### **1.5.2 Session Key Routing Pattern (Multi-Agent Isolation)**

**OpenClaw Format**: `agent:id:session:key`

**Why ant needs this**:
- Current ant: Single main agent, implicit routing
- OpenClaw: N agents, explicit routing via session key
- Pattern enables multi-agent systems easily

**Implementation for ant**:
```typescript
// Session key structure for ant
// format: "main:worker:subagent-id:attempt-N"
//          └ agent type (main|worker|subagent)
//             └ specific agent ID
//                └ sub-agent ID
//                   └ attempt number

function parseSessionKey(key: string) {
  const parts = key.split(":");
  return {
    agentType: parts[0],     // "main"
    agentId: parts[1],       // "worker"
    subagentId: parts[2],    // "subagent-123"
    attempt: parseInt(parts[3]),  // 1
  };
}
```

**Benefit**: Clear identity propagation, no string manipulation errors.

### **1.5.3 Lane-Based Concurrency (Critical for ant)**

OpenClaw's lane system prevents main agent from blocking:

```typescript
enum CommandLane {
  Main = "main",          // User-facing (priority: HIGH)
  Cron = "cron",          // Scheduled jobs (priority: LOW)
  Subagent = "subagent",  // Sub-agent tasks (priority: NORMAL)
  Nested = "nested"       // Nested invocations (priority: NORMAL)
}

// Each lane has:
// - Serial execution (1 concurrent)
// - Own queue
// - Own worker thread/process
```

**Why ant needs this**:
- Current: Main agent can hang waiting for sub-agent
- With lanes: Main continues, sub-agent queued separately
- Result: 5+ concurrent sub-agents, main stays responsive

**Queue depth monitoring** (from OpenClaw):
```typescript
interface LaneMonitor {
  laneId: string
  queueDepth: number
  avgWaitTime: number
  isBackpressured: boolean
}

// Warning at 10s wait time
// Error at 1m wait time
```

### **1.5.4 Event-Sourced Status Updates (vs Snapshots)**

**OpenClaw approach** (not implemented in ant):

```typescript
// Publish delta events instead of full state

stream.publish("task.status.changed", {
  taskId: "task-123",
  previousState: "RUNNING",
  newState: "COMPLETED",
  timestamp: Date.now(),
  progress?: { completed: 5, total: 5 }
})

// WebSocket subscriber gets only changes, not full state
```

**Ant's current broken approach**:
```typescript
// Every 1 second, compute ENTIRE state and broadcast
const snapshot = JSON.stringify(getFullSystemState());
if (snapshot !== lastSnapshot) {
  broadcast(snapshot);
}
// Results in 100KB+ per second on wire
```

**OpenClaw's efficient approach**:
```typescript
// Emit 200-byte delta only when changed
// Saves 500x bandwidth
```

### **1.5.5 Configuration Cascades (Multi-Level Defaults)**

**OpenClaw's 4-level cascade**:
```
Level 1: Global defaults (hard-coded)
  ↓
Level 2: Agent-level config (agent.yaml)
  ↓
Level 3: Session overrides (runtime)
  ↓
Level 4: Tool-specific overrides
```

**Implementation for ant**:
```typescript
// Global defaults
const defaults = {
  maxRetries: 3,
  retryBackoffMs: 1000,
  timeoutMs: 120_000,
};

// Agent-level (for Main Agent)
const mainAgentConfig = {
  ...defaults,
  maxRetries: 5,        // ← Override
};

// Session-level (for specific task)
async createTask(description, overrides) {
  const config = {
    ...mainAgentConfig,
    ...overrides,
  };
}
```

**Benefit**: Fine-grained control without duplicating config everywhere.

### **1.5.6 Tool Result Guarding (Session Isolation)**

**OpenClaw pattern**:
```typescript
// Wrap session manager to validate tool results
// Prevents tool result pollution across sessions

sessionToolResultGuardWrapper.ts:
  - Intercepts tool results
  - Validates they belong to current session
  - Persists only if valid
  - Silently drops cross-session results
```

**Why ant needs this**:
- Tool results currently global
- With concurrent sub-agents, results could leak between tasks
- Guard ensures session isolation

---

## PHASE 2: IMPLEMENTATION BLUEPRINT (SUPER DETAILED)

### 2.1 Architecture Changes Required

#### **2.1.1 New Task State Machine (Based on OpenClaw Patterns)**

```
Current (Broken):
  "pending" → "delegated" → "in_progress" → "completed"
                  ↓
               (string status)

Target (Hierarchical):
  PENDING → QUEUED → RUNNING → SUCCEEDED
    ↑                   ↓
    └─────── RETRY ← FAILED
              ↓
           (Exponential backoff)

With Sub-states (OpenClaw-inspired):
  RUNNING has: {
    subagentLaunched: timestamp
    currentPhase: "planning" | "executing" | "verifying"
    progress: { completed: N, total: M }
    lastHeartbeat: timestamp
    iterations: [attempt logs]
    messageSnapshot: Message[]  // ← From OpenClaw's embedded runner
  }

State Transitions:
  PENDING: Initial state after task creation
  QUEUED: Task in queue, waiting for lane slot
  RUNNING:
    ├─ Planning phase (build plan, max 3 iterations)
    ├─ Executing phase (execute plan, max 5 iterations)
    └─ Verifying phase (verify results, max 2 iterations)
  SUCCEEDED: All phases completed successfully
  FAILED: Phase failed, may retry
  RETRYING: Scheduled for retry with backoff
```

**Implementation** (incorporating OpenClaw's state machine pattern):
```typescript
// src/agent/task/state-machine.ts
enum TaskState {
  PENDING = "pending",
  QUEUED = "queued",
  RUNNING = "running",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  RETRYING = "retrying"
}

class TaskStateMachine {
  private state: TaskState = TaskState.PENDING;
  private stateHistory: Array<{state: TaskState, at: number, reason?: string}> = [];

  async transition(newState: TaskState, reason?: string): Promise<void> {
    // Validate legal transition
    if (!this.isLegalTransition(this.state, newState)) {
      throw new Error(`Illegal transition: ${this.state} → ${newState}`);
    }

    this.state = newState;
    this.stateHistory.push({ state: newState, at: Date.now(), reason });

    // Persist to disk
    await this.persist();

    // Publish event (for event stream integration)
    eventEmitter.emit("task.state.changed", {
      taskId: this.taskId,
      previousState: this.stateHistory[-2]?.state,
      newState,
      reason,
      timestamp: Date.now()
    });
  }

  private isLegalTransition(from: TaskState, to: TaskState): boolean {
    const allowed: Record<TaskState, TaskState[]> = {
      [TaskState.PENDING]: [TaskState.QUEUED],
      [TaskState.QUEUED]: [TaskState.RUNNING, TaskState.FAILED],
      [TaskState.RUNNING]: [TaskState.SUCCEEDED, TaskState.FAILED],
      [TaskState.FAILED]: [TaskState.RETRYING, TaskState.FAILED],
      [TaskState.RETRYING]: [TaskState.QUEUED],
      [TaskState.SUCCEEDED]: [],  // Terminal state
    };
    return allowed[from]?.includes(to) ?? false;
  }
}
```

**File**: Create `src/agent/task/state-machine.ts`
- Enum: TaskState with all above states
- Class: TaskStateMachine with transitions + validation
- Event: TaskStateChanged (published to event stream)
- Persistence: Each state change persisted to task file

#### **2.1.2 Persistent Task Registry**

```typescript
// src/agent/task/task-store.ts
interface TaskEntry {
  taskId: string;                          // UUID
  parentTaskId?: string;                   // For hierarchical tracking
  createdAt: number;                       // ms timestamp
  updatedAt: number;                       // Last status change
  status: TaskState;                       // New state machine
  description: string;
  sessionKey: string;                      // Session key this task runs in
  subagentSessionKey?: string;             // Sub-agent session if spawned
  result?: {
    content: string;
    toolsUsed: string[];
    iterations: number;
    providerId?: string;
  };
  phase?: "planning" | "executing" | "verifying";
  progress?: {
    completed: number;
    total: number;
    lastUpdate: number;
  };
  retries: {
    attempted: number;
    maxAttempts: number;
    nextRetryAt?: number;
    backoffMs?: number;
  };
  timeout?: {
    startedAt: number;
    maxDurationMs: number;
    willExpireAt: number;
  };
  metadata: {
    channel: "whatsapp" | "cli" | "web";
    priority: "high" | "normal" | "low";
    tags: string[];
  };
}

// Stored at .ant/tasks/<taskId>.json
// Cached with 45s TTL like OpenClaw's session store
```

**Implementation Location**: `src/agent/task/`
- `task-store.ts` - Persistent registry with TTL caching (import OpenClaw pattern)
- `task-state.ts` - State machine definition and transitions
- `task-types.ts` - TaskEntry, TaskResult types

#### **2.1.3 Lane-Based Concurrency System**

```typescript
// src/agent/concurrency/lanes.ts
enum TaskLane {
  Main = "main",              // Primary agent duties (high priority)
  Autonomous = "autonomous",  // Sub-agent tasks (medium priority)
  Maintenance = "maintenance" // Drone flights, cleanup (low priority)
}

// Each lane has its own queue
// Main lane: Serial (1 concurrent task)
// Autonomous lane: Parallel (N concurrent tasks, configurable)
// Maintenance lane: Serial (1 concurrent task) to avoid interference
```

**Implementation**:
- `src/agent/concurrency/lanes.ts` - Enum + lane configuration
- `src/agent/concurrency/task-queue.ts` - Per-lane queue management (import from OpenClaw)
- `src/agent/concurrency/queue-monitor.ts` - Monitor queue depth, wait times

**Benefits**:
- Sub-agent tasks don't block main agent
- Drone flights don't interfere with user tasks
- Autonomous lane can scale to N parallel executors

#### **2.1.4 Hierarchical Status Events**

```typescript
// src/monitor/types.ts - NEW event types
interface TaskStatusChanged {
  type: "task.status.changed";
  timestamp: number;
  taskId: string;
  parentTaskId?: string;
  previousState: TaskState;
  newState: TaskState;
  reason?: string;
}

interface SubagentProgressUpdated {
  type: "subagent.progress.updated";
  timestamp: number;
  parentTaskId: string;
  subagentTaskId: string;
  phase: "planning" | "executing" | "verifying";
  progress: { completed: number; total: number };
  message?: string;
}

interface TaskPhaseChanged {
  type: "task.phase.changed";
  timestamp: number;
  taskId: string;
  previousPhase: string;
  newPhase: string;
}

interface TaskTimeoutWarning {
  type: "task.timeout.warning";
  timestamp: number;
  taskId: string;
  msUntilTimeout: number;
}
```

**Event Stream Integration**:
- When TaskEntry.status changes → emit TaskStatusChanged
- When sub-agent progress updates → emit SubagentProgressUpdated
- When phase changes → emit TaskPhaseChanged
- When timeout approaching → emit TaskTimeoutWarning

---

### 2.2 Main Agent Refactoring (DETAILED)

**Current Problems in `src/agent/main-agent.ts`**:
- Line 42-43: Tasks stored in `Map<string, MainAgentTask>`
- Line 310-398: Hardcoded two-phase prompt (PLAN → EXECUTE)
- Line ~500: Completion detected by promise token string matching
- No persistence, no retry logic, no concurrency

**Target Architecture**:

#### **2.2.1 Main Agent Duties Refactored**

```typescript
// src/agent/main-agent.ts - REFACTORED

class MainAgent {
  private taskQueue: TaskQueue;      // Lane-based queue
  private taskStore: TaskStore;      // Persistent registry
  private eventEmitter: EventEmitter; // Published to event stream

  async processMainAgentDuty(query: string): Promise<void> {
    // 1. Create task entry
    const task = await this.taskStore.create({
      description: query,
      priority: "high",
      lane: TaskLane.Main,
      metadata: { channel: "cli" }
    });

    // 2. Emit event
    this.eventEmitter.emit("task.created", task);

    // 3. Enqueue to Main lane
    this.taskQueue.enqueueMain(task);

    // 4. Wait for completion (with timeout)
    const result = await this.taskQueue.waitForCompletion(task.taskId, {
      timeout: 30_000
    });

    // 5. Update status (automatically emits TaskStatusChanged event)
    await this.taskStore.updateStatus(task.taskId, TaskState.Completed, {
      result
    });
  }
}
```

#### **2.2.2 Two-Phase Subagent Execution (Formalized)**

```typescript
// src/agent/subagent/execution-phases.ts

interface PhaseDefinition {
  name: "planning" | "executing" | "verifying";
  systemPrompt: string;
  tools: Set<string>;
  maxIterations: number;
  successCriteria?: (output: AgentOutput) => boolean;
}

const SUBAGENT_PHASES: Map<string, PhaseDefinition[]> = new Map([
  ["main-task", [
    {
      name: "planning",
      systemPrompt: "You are a planning agent...",
      tools: new Set(["reasoning"]),
      maxIterations: 3
    },
    {
      name: "executing",
      systemPrompt: "You are an execution agent...",
      tools: new Set(["file", "system", "memory"]),
      maxIterations: 5
    },
    {
      name: "verifying",
      systemPrompt: "You are a verification agent...",
      tools: new Set(["file", "system"]),
      maxIterations: 2,
      successCriteria: (output) => output.response.includes("SUCCESS")
    }
  ]]
]);

// Execute each phase and track progress
async function executePhases(
  taskId: string,
  phases: PhaseDefinition[]
): Promise<PhaseResult[]> {
  const results: PhaseResult[] = [];

  for (const phase of phases) {
    // Update status to show current phase
    await taskStore.updatePhase(taskId, phase.name);

    // Emit progress
    eventEmitter.emit("task.phase.changed", {
      taskId,
      newPhase: phase.name
    });

    // Execute phase in sub-agent session
    const result = await executePhaseInSubagent(taskId, phase);
    results.push(result);

    // Check success criteria
    if (phase.successCriteria && !phase.successCriteria(result)) {
      throw new PhaseFailedError(phase.name);
    }
  }

  return results;
}
```

**Files to Create**:
- `src/agent/subagent/execution-phases.ts` - Phase definitions
- `src/agent/subagent/phase-executor.ts` - Phase execution logic
- `src/agent/subagent/phase-result.ts` - Phase result types

#### **2.2.3 Proper Subagent Spawning**

```typescript
// src/agent/subagent/spawner.ts

interface SubagentSpawnRequest {
  taskId: string;           // Parent task ID
  description: string;
  phases: PhaseDefinition[];
  sessionKey: string;       // Parent session
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
}

async function spawnSubagent(req: SubagentSpawnRequest): Promise<string> {
  // 1. Create sub-task entry
  const subTask = await taskStore.create({
    description: req.description,
    parentTaskId: req.taskId,
    priority: "normal",
    lane: TaskLane.Autonomous,
    timeout: {
      startedAt: Date.now(),
      maxDurationMs: req.timeoutMs || 120_000,
      willExpireAt: Date.now() + (req.timeoutMs || 120_000)
    }
  });

  // 2. Create sub-agent session (format: parent:subagent:taskId)
  const subSessionKey = `${req.sessionKey}:subagent:${subTask.taskId}`;
  await sessionManager.createSession(subSessionKey);

  // 3. Store session reference in task
  await taskStore.update(subTask.taskId, {
    subagentSessionKey: subSessionKey
  });

  // 4. Enqueue to Autonomous lane
  this.taskQueue.enqueueAutonomous(subTask);

  // 5. Return immediately (async execution)
  return subTask.taskId;
}

async function waitForSubagent(
  parentTaskId: string,
  subTaskId: string,
  timeout: number
): Promise<TaskResult> {
  return this.taskQueue.waitForCompletion(subTaskId, { timeout });
}
```

**Key Differences from Current**:
- ✅ Formal SpawnRequest interface (no string prompts)
- ✅ Sub-task persisted to registry (not just in memory)
- ✅ Phase definitions explicit (not hardcoded prompts)
- ✅ Timeout tracked per-task (not global)
- ✅ Session key follows OpenClaw format
- ✅ Returns task ID immediately (no blocking)

---

### 2.3 Gateway Status Refactoring (DETAILED)

**Current Problem** (`src/gateway/server.ts`, lines 315-360):
```typescript
// BROKEN: Full state snapshot every 1s
const lastStatus = JSON.stringify(currentStatus);
const newStatus = JSON.stringify(getCurrentStatus());
if (lastStatus !== newStatus) {
  broadcast(newStatus);
}
```

**Why This Fails**:
1. JSON.stringify() expensive for large state
2. Clients receive entire state (100 KB+) instead of deltas
3. No ability to subscribe to specific tasks
4. Network bandwidth wasted

#### **2.3.1 Event-Driven Status Broadcasting**

```typescript
// src/gateway/server.ts - REFACTORED

class GatewayServer {
  private eventSubscriptions: Map<string, Set<WebSocket>> = new Map();

  async handleWebSocketConnect(ws: WebSocket): Promise<void> {
    // Client sends: { subscribe: "task.status.changed" }
    ws.on("message", (msg) => {
      const { subscribe } = JSON.parse(msg);

      if (!this.eventSubscriptions.has(subscribe)) {
        this.eventSubscriptions.set(subscribe, new Set());
      }
      this.eventSubscriptions.get(subscribe)!.add(ws);
    });
  }

  // Called by event stream when task status changes
  onTaskStatusChanged(event: TaskStatusChanged): void {
    const subscribers = this.eventSubscriptions.get("task.status.changed") || [];

    subscribers.forEach(ws => {
      ws.send(JSON.stringify({
        type: "delta",
        event: {
          type: event.type,
          taskId: event.taskId,
          previousState: event.previousState,
          newState: event.newState,
          timestamp: event.timestamp
        }
      }));
    });
  }

  onSubagentProgressUpdated(event: SubagentProgressUpdated): void {
    const subscribers = this.eventSubscriptions.get("subagent.progress.updated") || [];

    subscribers.forEach(ws => {
      ws.send(JSON.stringify({
        type: "delta",
        event: {
          type: event.type,
          parentTaskId: event.parentTaskId,
          subagentTaskId: event.subagentTaskId,
          phase: event.phase,
          progress: event.progress,
          timestamp: event.timestamp
        }
      }));
    });
  }

  // Removed: polling loop that broadcasts full state
  // Removed: snapshot comparison logic
}
```

**Implementation Steps**:
1. Create `src/gateway/event-subscriber.ts` - Event routing logic
2. Refactor `src/gateway/server.ts` - Remove snapshot broadcasting
3. Update WebSocket client API - Document new event subscriptions
4. Add event rate limiting - Debounce progress updates

#### **2.3.2 Full Status Snapshot API (For Clients)**

```typescript
// src/gateway/server.ts - NEW endpoint

app.get("/api/status/full", async (req, res) => {
  // Called on client reconnect or refresh
  // Returns full state snapshot (expensive, but only on-demand)

  const tasks = await taskStore.getAllTasks();
  const statuses = await Promise.all(
    tasks.map(t => buildTaskStatus(t))
  );

  res.json({
    timestamp: Date.now(),
    tasks: statuses,
    // Etag for caching
    etag: computeEtag(statuses)
  });
});

app.get("/api/status/task/:taskId", async (req, res) => {
  // Per-task status (small payload)
  const task = await taskStore.getTask(req.params.taskId);
  const status = await buildTaskStatus(task);

  res.json(status);
});
```

---

### 2.4 Timeout & Failure Detection (DETAILED)

**Current State**: Timeouts configured but not enforced

#### **2.4.1 Task Timeout Monitor**

```typescript
// src/agent/concurrency/timeout-monitor.ts

class TimeoutMonitor {
  private checkInterval: NodeJS.Timer;

  start(): void {
    this.checkInterval = setInterval(async () => {
      const tasks = await taskStore.getActiveTasks();

      for (const task of tasks) {
        if (!task.timeout) continue;

        const msUntilTimeout = task.timeout.willExpireAt - Date.now();

        // Warn at 10s before timeout
        if (msUntilTimeout <= 10_000 && msUntilTimeout > 0) {
          eventEmitter.emit("task.timeout.warning", {
            taskId: task.taskId,
            msUntilTimeout
          });
        }

        // Kill task at timeout
        if (msUntilTimeout <= 0) {
          await this.killTask(task.taskId, "timeout");
        }
      }
    }, 1_000); // Check every 1 second
  }

  private async killTask(taskId: string, reason: string): Promise<void> {
    // 1. Update status to TIMEOUT
    await taskStore.updateStatus(taskId, TaskState.Failed, {
      error: reason
    });

    // 2. Emit event
    eventEmitter.emit("task.timeout", {
      taskId,
      timestamp: Date.now()
    });

    // 3. Clean up sub-agent session if exists
    const task = await taskStore.getTask(taskId);
    if (task.subagentSessionKey) {
      await sessionManager.abortSession(task.subagentSessionKey);
    }

    // 4. Trigger retry if applicable
    if (task.retries.attempted < task.retries.maxAttempts) {
      await this.scheduleRetry(task);
    }
  }

  private async scheduleRetry(task: TaskEntry): Promise<void> {
    const backoffMs = Math.min(
      1000 * Math.pow(2, task.retries.attempted),
      60_000 // Cap at 1 minute
    );

    const nextRetryAt = Date.now() + backoffMs;

    await taskStore.update(task.taskId, {
      status: TaskState.Queued,
      retries: {
        ...task.retries,
        attempted: task.retries.attempted + 1,
        nextRetryAt
      },
      timeout: {
        startedAt: Date.now(),
        maxDurationMs: task.timeout?.maxDurationMs || 120_000,
        willExpireAt: Date.now() + (task.timeout?.maxDurationMs || 120_000)
      }
    });

    // Re-enqueue with delay
    this.taskQueue.enqueueWithDelay(task.taskId, backoffMs);
  }

  stop(): void {
    clearInterval(this.checkInterval);
  }
}
```

**Files to Create**:
- `src/agent/concurrency/timeout-monitor.ts`
- `src/agent/concurrency/failure-detector.ts`

#### **2.4.2 Completion Detection (Structured)**

**Replace**:
```typescript
// OLD (broken): String matching
if (output.response.includes("<promise>COMPLETE</promise>")) {
  task.status = "completed";
}
```

**With**:
```typescript
// NEW (structured): Event-based completion
interface CompletionSignal {
  type: "completion";
  taskId: string;
  status: "succeeded" | "failed";
  result?: any;
  error?: string;
}

// Tool can emit structured completion
async function emitCompletion(signal: CompletionSignal): Promise<void> {
  eventEmitter.emit("task.completion.signal", signal);

  const newState = signal.status === "succeeded"
    ? TaskState.Completed
    : TaskState.Failed;

  await taskStore.updateStatus(signal.taskId, newState, {
    result: signal.result,
    error: signal.error
  });
}
```

---

### 2.5 Event Stream Integration (DETAILED)

**Current State**: `src/monitor/event-stream.ts` exists but disconnected from main agent

#### **2.5.1 Hook Task Events to Event Stream**

```typescript
// src/agent/task/task-store.ts - MODIFICATIONS

class TaskStore {
  constructor(
    private eventEmitter: EventEmitter, // DI event emitter
    private eventStream: EventStream     // Ant's existing system
  ) {}

  async create(entry: Partial<TaskEntry>): Promise<TaskEntry> {
    const task = { ...entry, taskId: uuid() } as TaskEntry;

    // 1. Write to file
    await fs.writeFile(
      `${TASK_DIR}/${task.taskId}.json`,
      JSON.stringify(task)
    );

    // 2. Emit to local event emitter
    this.eventEmitter.emit("task.created", task);

    // 3. Publish to event stream (for monitoring)
    this.eventStream.publish({
      type: "MainAgentTaskCreated",
      data: {
        taskId: task.taskId,
        description: task.description,
        createdAt: task.createdAt
      }
    });

    return task;
  }

  async updateStatus(
    taskId: string,
    newState: TaskState,
    metadata?: any
  ): Promise<void> {
    const task = await this.getTask(taskId);
    const previousState = task.status;

    // 1. Update file
    task.status = newState;
    task.updatedAt = Date.now();
    await fs.writeFile(
      `${TASK_DIR}/${taskId}.json`,
      JSON.stringify(task)
    );

    // 2. Emit event
    this.eventEmitter.emit("task.status.changed", {
      taskId,
      previousState,
      newState,
      timestamp: Date.now()
    });

    // 3. Publish to event stream
    this.eventStream.publish({
      type: "MainAgentTaskStatusChanged",
      data: {
        taskId,
        previousState: TaskState[previousState],
        newState: TaskState[newState],
        reason: metadata?.reason,
        timestamp: Date.now()
      }
    });

    // 4. Broadcast to WebSocket clients
    this.eventEmitter.emit("gateway.broadcast", {
      type: "task.status.changed",
      taskId,
      newState
    });
  }

  // Similar hooks for updatePhase, updateProgress, etc.
}
```

#### **2.5.2 New Event Types in Event Stream**

Add to `src/monitor/types.ts`:
```typescript
interface MainAgentTaskCreated {
  type: "MainAgentTaskCreated";
  data: {
    taskId: string;
    description: string;
    createdAt: number;
  };
}

interface MainAgentTaskStatusChanged {
  type: "MainAgentTaskStatusChanged";
  data: {
    taskId: string;
    previousState: string;
    newState: string;
    reason?: string;
    timestamp: number;
  };
}

interface SubagentTaskCreated {
  type: "SubagentTaskCreated";
  data: {
    taskId: string;
    parentTaskId: string;
    description: string;
    createdAt: number;
  };
}

interface SubagentProgressUpdated {
  type: "SubagentProgressUpdated";
  data: {
    parentTaskId: string;
    subagentTaskId: string;
    phase: string;
    progress: { completed: number; total: number };
    timestamp: number;
  };
}

interface TaskTimeoutOccurred {
  type: "TaskTimeoutOccurred";
  data: {
    taskId: string;
    reason: "timeout" | "aborted";
    timestamp: number;
  };
}

interface TaskRetryScheduled {
  type: "TaskRetryScheduled";
  data: {
    taskId: string;
    attempt: number;
    nextRetryAt: number;
    backoffMs: number;
  };
}
```

---

### 2.6 Configuration System Updates (DETAILED)

**Apply OpenClaw's Configuration Cascade Pattern**

#### **2.6.1 New Config Schema**

```typescript
// src/config.ts - ADDITIONS

const AgentExecutionConfig = z.object({
  // Task execution
  tasks: z.object({
    registry: z.object({
      dir: z.string().default("./.ant/tasks"),
      cacheTtlMs: z.number().default(45_000),
      maxHistorySize: z.number().default(1000)
    }),
    defaults: z.object({
      timeoutMs: z.number().default(120_000),
      maxRetries: z.number().default(3),
      retryBackoffMs: z.number().default(1000),
      retryBackoffMultiplier: z.number().default(2),
      retryBackoffCap: z.number().default(60_000)
    })
  }),

  // Lane configuration
  lanes: z.object({
    main: z.object({
      maxConcurrent: z.number().default(1),
      priority: z.literal("high")
    }),
    autonomous: z.object({
      maxConcurrent: z.number().default(5),
      priority: z.literal("normal")
    }),
    maintenance: z.object({
      maxConcurrent: z.number().default(1),
      priority: z.literal("low")
    })
  }),

  // Subagent execution
  subagents: z.object({
    phases: z.array(z.object({
      name: z.string(),
      systemPrompt: z.string(),
      tools: z.array(z.string()),
      maxIterations: z.number()
    })).optional(),
    timeoutMs: z.number().default(120_000),
    maxRetries: z.number().default(2)
  }),

  // Monitoring
  monitoring: z.object({
    eventBuffer: z.number().default(1000),
    timeoutCheckIntervalMs: z.number().default(1000),
    statusBroadcastDebounceMs: z.number().default(200)
  })
});
```

#### **2.6.2 Config File Updates**

```yaml
# .ant/config.yaml - ADDITIONS

agentExecution:
  tasks:
    registry:
      dir: ./.ant/tasks
      cacheTtlMs: 45000
    defaults:
      timeoutMs: 120000
      maxRetries: 3
      retryBackoffMs: 1000

  lanes:
    main:
      maxConcurrent: 1
    autonomous:
      maxConcurrent: 5
    maintenance:
      maxConcurrent: 1

  subagents:
    phases:
      - name: planning
        systemPrompt: |
          You are a planning expert...
        tools: [reasoning]
        maxIterations: 3
      - name: executing
        systemPrompt: |
          You are an execution expert...
        tools: [file, system, memory]
        maxIterations: 5
    timeoutMs: 120000

  monitoring:
    eventBuffer: 1000
    timeoutCheckIntervalMs: 1000
```

---

### 2.7 Data Migration Strategy (DETAILED)

**For systems with existing tasks**:

```typescript
// src/agent/migration/migrate-tasks.ts

async function migrateExistingTasks(): Promise<void> {
  console.log("[Migration] Starting task migration from memory to file-based registry");

  // 1. Export current in-memory tasks (from MainAgent.tasks Map)
  const mainAgent = await getMainAgentInstance();
  const oldTasks = Array.from(mainAgent.tasks.values());

  // 2. Create new task registry
  const taskStore = new TaskStore();
  await fs.mkdir(TASK_DIR, { recursive: true });

  // 3. Migrate each task
  for (const oldTask of oldTasks) {
    const newTask: TaskEntry = {
      taskId: oldTask.id,
      createdAt: oldTask.createdAt || Date.now(),
      updatedAt: oldTask.completedAt || Date.now(),
      status: migrateTaskStatus(oldTask.status),
      description: oldTask.description,
      sessionKey: mainAgent.sessionKey,
      subagentSessionKey: oldTask.subagentSessionKey,
      result: oldTask.result ? {
        content: oldTask.result,
        toolsUsed: [],
        iterations: 0
      } : undefined,
      retries: {
        attempted: oldTask.retries,
        maxAttempts: oldTask.maxRetries || 3
      },
      metadata: {
        channel: "cli",
        priority: "normal",
        tags: []
      }
    };

    await taskStore.create(newTask);
  }

  console.log(`[Migration] Migrated ${oldTasks.length} tasks`);
  console.log("[Migration] Backup of old tasks available at .ant/tasks-backup.json");
}

function migrateTaskStatus(oldStatus: string): TaskState {
  const mapping: Record<string, TaskState> = {
    "pending": TaskState.Pending,
    "delegated": TaskState.Queued,
    "in_progress": TaskState.Running,
    "completed": TaskState.Completed,
    "failed": TaskState.Failed
  };
  return mapping[oldStatus] || TaskState.Pending;
}
```

---

## PHASE 3: IMPLEMENTATION SEQUENCE (SUPER DETAILED)

### 3.1 Checkpoint 1: Foundation

**Deliverable**: Persistent task registry with caching

**Tasks**:
1. **Create Task Types & State Machine**
   - File: `src/agent/task/types.ts`
   - File: `src/agent/task/state-machine.ts`
   - Review: Validate against OpenClaw's state model

2. **Implement Persistent Task Store**
   - File: `src/agent/task/task-store.ts`
   - Import: OpenClaw's session store caching pattern
   - TTL: 45 seconds (like OpenClaw)
   - Validation: Unit tests for CRUD operations
   - Test: Verify cache invalidation on file changes

3. **Create Lane System**
   - File: `src/agent/concurrency/lanes.ts`
   - File: `src/agent/concurrency/task-queue.ts`
   - Import: CommandQueue pattern from OpenClaw
   - Validation: Verify serial execution in Main lane

4. **Create Basic Task Lifecycle**
   - File: `src/agent/task/task-executor.ts`
   - Minimal: Just Pending → Running → Completed
   - No retries yet

**Validation**:
```bash
# Can create tasks
ant task create "Test task"

# Can list tasks with status
ant task list --json | jq '.[] | {id, status}'

# Can see task cache hit/miss
ant task get <taskId> --cache-stats
```

---

### 3.2 Checkpoint 2: Event Stream Integration

**Deliverable**: Task events published to event stream

**Tasks**:
1. **Add Task Event Types**
   - File: `src/monitor/types.ts`
   - Events: TaskCreated, StatusChanged, PhaseChanged, TimeoutWarning
   - Validation: Event schema compliance

2. **Hook TaskStore to EventEmitter**
   - File: `src/agent/task/task-store.ts`
   - Integration: Publish on create, status change, phase change
   - Validation: Event emission in logs

3. **Update Main Agent to Use TaskStore**
   - File: `src/agent/main-agent.ts`
   - Replace: `tasks: Map` → `taskStore`
   - Change: Persistence automatic via TaskStore
   - Validation: Restart doesn't lose tasks

**Validation**:
```bash
# Events visible in event stream
ant monitor --event-type "task.status.changed" --follow

# Task persists across restart
ant task list --before-restart > before.json
ant restart
ant task list --after-restart > after.json
diff before.json after.json  # Should be empty
```

---

### 3.3 Checkpoint 3: Sub-agent Management

**Deliverable**: Lane-based sub-agent execution with phase tracking

**Tasks**:
1. **Create Phase Execution System**
   - File: `src/agent/subagent/execution-phases.ts`
   - File: `src/agent/subagent/phase-executor.ts`
   - Formalize: PLAN → EXECUTE → VERIFY phases
   - Validation: Each phase runs in isolation

2. **Implement Subagent Spawner**
   - File: `src/agent/subagent/spawner.ts`
   - Pattern: Follow OpenClaw's sessions-spawn-tool.ts
   - Session Key: Format `sessionId:subagent:taskId`
   - Validation: Sub-tasks enqueued to Autonomous lane

3. **Lane-based Concurrent Execution**
   - File: `src/agent/concurrency/executor.ts`
   - Implement: Main lane (serial), Autonomous lane (parallel N), Maintenance lane (serial)
   - Validation: 5 sub-agents run in parallel

4. **Progress Tracking for Sub-agents**
   - File: `src/agent/subagent/progress-tracker.ts`
   - Emit: SubagentProgressUpdated events every 2s
   - Track: Phase, completion %, iterations
   - Validation: Progress visible in event stream

**Validation**:
```bash
# Create task with multiple sub-tasks
ant task create "Complex operation" --auto-spawn

# See parallel execution
ant task list --format=tree
# Output:
#   Main: task-1 (RUNNING)
#     ├─ Sub: task-1-1 (RUNNING, planning)
#     ├─ Sub: task-1-2 (RUNNING, executing)
#     └─ Sub: task-1-3 (QUEUED)

# Stream sub-agent progress
ant monitor --event-type "subagent.progress.updated" --follow
```

---

### 3.4 Checkpoint 4: Timeout & Failure Handling

**Deliverable**: Timeout detection and exponential backoff retry

**Tasks**:
1. **Implement Timeout Monitor**
   - File: `src/agent/concurrency/timeout-monitor.ts`
   - Check: Every 1 second
   - Warn: At 10 seconds before timeout
   - Kill: At timeout expiration
   - Validation: Task killed after N seconds

2. **Structured Completion Detection**
   - File: `src/agent/task/completion-detector.ts`
   - Replace: String matching → Event-based
   - Validation: Immediate task completion on signal

3. **Exponential Backoff Retry**
   - File: `src/agent/concurrency/retry-scheduler.ts`
   - Formula: min(1000 * 2^attempt, 60000)
   - Persist: nextRetryAt in task file
   - Validation: Failed task retries with increasing delay

**Validation**:
```bash
# Task times out after 5s
ant task create "long_operation" --timeout=5000
sleep 6
ant task get <taskId> --json | jq '.status'  # FAILED

# See timeout warning 10s before
ant monitor --event-type "task.timeout.warning" --follow

# Failed task retries with backoff
ant task list --filter="status=FAILED" | head -1 | jq '.retries'
# Output: { attempted: 1, maxAttempts: 3, nextRetryAt: 1643234567890 }
```

---

### 3.5 Checkpoint 5: Gateway Status Broadcasting

**Deliverable**: Event-driven WebSocket status updates

**Tasks**:
1. **Refactor Gateway Status Broadcasting**
   - File: `src/gateway/event-subscriber.ts`
   - Remove: Snapshot polling loop
   - Add: Event-based subscription routing
   - Validation: No more full-state broadcasts

2. **WebSocket Event Routing**
   - File: `src/gateway/server.ts`
   - API: `/subscribe?event=task.status.changed`
   - Implement: Per-event subscriber tracking
   - Validation: Clients receive deltas only

3. **Full Status API (On-Demand)**
   - File: `src/gateway/server.ts`
   - Endpoint: `GET /api/status/full`
   - Use Case: Client reconnect
   - Validation: ETag-based caching

**Validation**:
```bash
# Start WebSocket subscriber
wscat -c ws://localhost:8080/ws

# Broadcast:
# {"subscribe": "task.status.changed"}

# Create task (get live update)
ant task create "Test" --channel=http

# Output:
# {"type": "delta", "event": {"type": "task.status.changed", ...}}

# Verify no snapshot broadcasts
tcpdump -i lo 'tcp port 8080' | grep -c '"timestamp"'
# Should be low (only deltas, not snapshots)
```

---

### 3.6 Checkpoint 6: Configuration & Migration

**Deliverable**: Updated config schema and data migration

**Tasks**:
1. **Update Config Schema**
   - File: `src/config.ts`
   - Add: Task registry, lanes, phase definitions
   - Validation: Zod schema parsing

2. **Config File Examples**
   - File: `.ant/config.yaml`
   - Document: All new config options
   - Defaults: Sensible lane concurrency

3. **Migration Script**
   - File: `src/agent/migration/migrate-tasks.ts`
   - Backup: Old tasks to .ant/tasks-backup.json
   - Migrate: Status mapping to new TaskState
   - Validation: Count matches before/after

**Validation**:
```bash
# Run migration
ant migrate --from-memory-tasks --backup=true

# Verify
ant task list --count  # Should match pre-migration count
cat .ant/tasks-backup.json | jq 'length'  # Backup exists
```

---

### 3.7 Checkpoint 7: Comprehensive Testing

**Deliverable**: Full system test suite

**Tests to Create**:
1. **Task Lifecycle Tests**
   - Create → Running → Completed
   - Create → Running → Failed → Retry → Completed

2. **Concurrency Tests**
   - 5 tasks enqueued to Autonomous lane
   - Verify parallel execution (not sequential)
   - Verify Main lane still serial

3. **Timeout Tests**
   - Task timeout after N seconds
   - Verify status = FAILED
   - Verify retry scheduled

4. **Event Stream Tests**
   - Verify events published for each state change
   - Verify event metadata correct
   - Verify no duplicate events

5. **Gateway Broadcasting Tests**
   - WebSocket subscriber receives deltas
   - Verify no full-state snapshots
   - Verify ETag caching works

6. **Hierarchical Status Tests**
   - Parent task shows child progress
   - Progress aggregates correctly
   - Phase changes propagate

**Files to Create**:
- `src/agent/task/__tests__/task-store.test.ts`
- `src/agent/concurrency/__tests__/executor.test.ts`
- `src/agent/concurrency/__tests__/timeout-monitor.test.ts`
- `src/gateway/__tests__/event-subscriber.test.ts`
- `src/agent/__tests__/integration.test.ts`

---

## PHASE 4: VERIFICATION & VALIDATION

### 4.1 End-to-End Test Scenarios

#### **Scenario 1: Simple Task Execution**
```bash
# 1. Create task
ant task create "Write a report"

# 2. Monitor status in real-time
ant monitor --follow

# Expected in logs:
# task.created { taskId: "...", status: "PENDING" }
# task.status.changed { taskId: "...", status: "RUNNING" }
# task.status.changed { taskId: "...", status: "COMPLETED" }

# 3. Verify persistence
ant task list | grep "Write a report"
```

#### **Scenario 2: Hierarchical Sub-agent Execution**
```bash
# 1. Create complex task
ant task create "Build and test project" --phases=true

# 2. Monitor hierarchical progress
ant monitor --format=tree

# Expected:
# Main Task (RUNNING)
#   ├─ Sub-task 1: Build (COMPLETED)
#   ├─ Sub-task 2: Test (RUNNING, 45% complete)
#   └─ Sub-task 3: Deploy (QUEUED)

# 3. Check concurrent execution
curl http://localhost:8080/api/status/full | jq '.tasks[] | {taskId, status}'
```

#### **Scenario 3: Failure & Retry**
```bash
# 1. Create task that will fail
ant task create "Send to unreachable service" --will-fail

# 2. Monitor retry attempts
ant monitor --event-type "task.retry.scheduled"

# Expected:
# task.retry.scheduled { taskId: "...", attempt: 1, backoffMs: 1000 }
# task.retry.scheduled { taskId: "...", attempt: 2, backoffMs: 2000 }
# task.retry.scheduled { taskId: "...", attempt: 3, backoffMs: 4000 }

# 3. Eventually FAILED after max retries
ant task get <taskId> | jq '.status'
# FAILED
```

#### **Scenario 4: Timeout Detection**
```bash
# 1. Create task with short timeout
ant task create "Long-running task" --timeout=5000

# 2. Monitor timeout warning
ant monitor --event-type "task.timeout.warning"

# Expected at 4.5s:
# task.timeout.warning { taskId: "...", msUntilTimeout: 500 }

# 3. Task killed at timeout
sleep 1
ant task get <taskId> | jq '.status'
# FAILED
ant task get <taskId> | jq '.metadata.timeoutReason'
# "timeout"
```

#### **Scenario 5: WebSocket Broadcasting**
```bash
# Terminal 1: Subscribe to events
wscat -c ws://localhost:8080/ws
# Send: {"subscribe": "task.status.changed"}

# Terminal 2: Create tasks
ant task create "Task 1"
ant task create "Task 2"

# Terminal 1 output (deltas only):
# {"type": "delta", "event": {"type": "task.status.changed", ...}}
# (No full-state snapshots, only changes)
```

#### **Scenario 6: Restart Persistence**
```bash
# 1. Create task in state RUNNING
ant task create "Long operation"
sleep 2  # Let it run
ps aux | grep "ant" | kill -9 <pid>

# 2. Restart system
ant start

# 3. Task resumes from where it left off
ant task get <taskId> | jq '.status'
# RUNNING (not QUEUED)

# 4. Status history preserved
ant task get <taskId> | jq '.metadata.statusHistory[-2:]'
# [{ status: "PENDING", at: ... }, { status: "RUNNING", at: ... }]
```

### 4.2 Performance Benchmarks

| Metric | Target | Validation |
|--------|--------|------------|
| Task creation | < 50ms | `time ant task create "test"` |
| Task lookup (cached) | < 5ms | Cache hit for same task |
| Task lookup (disk) | < 20ms | Cache miss penalty |
| Event emission | < 2ms per event | Monitor event frequency |
| WebSocket broadcast | < 50ms to 100 clients | Load test 100 concurrent |
| Concurrent sub-agents | 5 in parallel | Monitor lane queue depth |
| Timeout detection | < 100ms latency | Clock skew measurement |

### 4.3 Metrics to Track

```typescript
// src/agent/metrics/task-metrics.ts
interface TaskMetrics {
  totalTasksCreated: number;
  currentActiveTasks: number;
  avgTaskDuration: number;
  tasksCompleted: number;
  tasksFailed: number;
  tasksRetried: number;
  laneQueueDepths: {
    main: number;
    autonomous: number;
    maintenance: number;
  };
  avgTimeToFirstEvent: number;  // Task creation to first status update
  avgWebSocketBroadcastLatency: number;
}
```

---

## PHASE 5: ROLLOUT STRATEGY

### 5.1 Feature Flags

```typescript
// src/config.ts - Feature flag additions
const FeatureFlags = z.object({
  useNewTaskRegistry: z.boolean().default(false),    // Phase 1
  useEventDrivenStatus: z.boolean().default(false),  // Phase 2
  useLaneBasedConcurrency: z.boolean().default(false), // Phase 3
  useStructuredCompletion: z.boolean().default(false), // Phase 4
  enableTimeoutMonitoring: z.boolean().default(false),  // Phase 4
  enableWebSocketDeltas: z.boolean().default(false)   // Phase 5
});
```

### 5.2 Gradual Rollout

1. **Internal Testing**
   - Enable all flags in dev/staging
   - Run integration tests
   - Verify no regressions

2. **Canary Phase** (10% of traffic)
   - New configs opt-in via env var
   - Monitor error rates
   - Track performance metrics

3. **Canary Phase** (10% of traffic)
   - New configs opt-in via env var
   - Monitor error rates
   - Track performance metrics

4. **Progressive Rollout**
   - 25% → 50% → 75% → 100%
   - Monitor each step for consistency
   - Rollback plan ready

5. **Cleanup**
   - Remove feature flags
   - Remove old code paths
   - Archive old task backup files

---

## CRITICAL SUCCESS FACTORS

### ✅ What Must Succeed

1. **Task Persistence**: No lost tasks on restart
2. **Status Visibility**: Users see real-time progress
3. **Sub-agent Parallelism**: 5+ concurrent sub-agents
4. **Timeout Enforcement**: Tasks killed after timeout
5. **Event Consistency**: No duplicate or missing events
6. **WebSocket Efficiency**: 10x reduction in network traffic

### ⚠️ Potential Risks

| Risk | Mitigation |
|------|-----------|
| Data corruption during migration | Backup all tasks before migration |
| Performance regression | Benchmark each checkpoint |
| Event stream overflow | Limit buffer to 1000 events |
| Sub-agent hang | Timeout + explicit kill signal |
| WebSocket connection storms | Rate limit subscriptions |

---

## FILE CHANGES SUMMARY

**Files to Create** (34 total):
- Task system: 8 files
- Concurrency: 6 files
- Sub-agent: 5 files
- Gateway: 3 files
- Monitoring: 4 files
- Migration: 2 files
- Tests: 6 files

**Existing Files to Refactor** (10 total):
- `src/agent/main-agent.ts` - changes
- `src/gateway/server.ts` - changes
- `src/monitor/types.ts` - additions
- `src/config.ts` - additions
- Plus 6 more test/config files

**Total Code Impact**: Comprehensive refactoring of core systems

---

## NEXT ITERATION IMPROVEMENTS

Once Phase 5 complete, consider:

1. **Distributed Task Execution** - Support remote executors (like OpenClaw federation)
2. **Task Templates** - Reusable task definitions with parameters
3. **Skill Registry** - Agents advertise capabilities (like OpenClaw subagent allowlists)
4. **Rate Limiting** - Token budgets per agent type
5. **Audit Trail** - Separate action log from conversational logs
6. **A/B Testing** - Feature flags for experimentation

---

## COMPLETION CRITERIA

This plan is **READY FOR EXECUTION** when:

✅ Checkpoint 1 (Foundation) complete - Can create, list, persist tasks
✅ Checkpoint 2 (Events) complete - Events published to event stream
✅ Checkpoint 3 (Sub-agents) complete - 5 concurrent sub-agents working
✅ Checkpoint 4 (Timeout/Retry) complete - Timeout + exponential backoff working
✅ Checkpoint 5 (Gateway) complete - WebSocket broadcasting 10x more efficient
✅ Checkpoint 6 (Config/Migration) complete - Data migrated, config updated
✅ Checkpoint 7 (Testing) complete - All test scenarios passing

---

**Plan Complete** ✓

/**
 * API Types
 * TypeScript interfaces for all API responses
 */

// ============================================
// Provider Types
// ============================================

export type ProviderInfo = {
  label: string;
  id: string;
  type: 'openai' | 'cli';
  model: string;
  baseUrl: string;
  cliProvider?: string;
};

// ============================================
// Queue Types
// ============================================

export type QueueLaneSnapshot = {
  lane: string;
  queued: number;
  active: number;
  maxConcurrent: number;
  oldestEnqueuedAt?: number;
};

export type QueueItemSnapshot = {
  lane: string;
  text: string;
  enqueuedAt: number;
};

export type QueueDetailSnapshot = {
  lane: string;
  items: QueueItemSnapshot[];
};

export type QueueDetailResponse = {
  ok: true;
  lanes: QueueDetailSnapshot[];
};

// ============================================
// Action Response
// ============================================

export type ActionResponse = {
  ok: boolean;
  error?: string;
  hint?: string;
};

// ============================================
// Task Types
// ============================================

export type MainTaskStatus = {
  sessionKey: string;
  chatId?: string;
  text: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  error?: string;
};

export type SubagentRecord = {
  id?: string;
  task: string;
  label?: string;
  status: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
};

export type ToolCall = {
  name: string;
  parameters: Record<string, unknown>;
  result: unknown;
  duration: number;
  timestamp: number;
};

export type Task = {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  toolCalls: ToolCall[];
  result?: string;
  error?: {
    message: string;
    stack: string;
    code: string;
  };
  subagents: Agent[];
  channel: 'whatsapp' | 'cli' | 'web';
  sessionKey: string;
  iterations: number;
};

export type TasksResponse = {
  ok: true;
  tasks: Task[];
};

export type TaskDetailResponse = {
  ok: true;
  task: Task;
};

// ============================================
// Agent Types
// ============================================

export type AgentCaste = 'queen' | 'worker' | 'soldier' | 'nurse' | 'forager' | 'architect' | 'drone';
export type AgentStatus = 'spawning' | 'active' | 'thinking' | 'idle' | 'retired' | 'error';

export type Agent = {
  id: string;
  caste: AgentCaste;
  name: string;
  status: AgentStatus;
  currentTask?: string;
  progress: number;
  toolsUsed: string[];
  taskCount: number;
  averageDuration: number;
  errorCount: number;
  createdAt: number;
  retiredAt?: number;
  parentAgentId?: string;
  error?: string;
  metadata: {
    age: number;
    energy: number;
    specialization: string[];
  };
};

export type AgentsResponse = {
  ok: true;
  agents: Agent[];
};

export type AgentDetailResponse = {
  ok: true;
  agent: Agent;
};

// ============================================
// Memory Types
// ============================================

export type Memory = {
  id: string;
  content: string;
  type: 'note' | 'session' | 'indexed' | 'learned' | 'system';
  category: string;
  tags: string[];
  embedding?: number[];
  searchScore?: number;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  references: string[];
};

export type MemorySearchResponse = {
  ok: true;
  results: Memory[];
  query: string;
};

export type MemoryIndexResponse = {
  ok: true;
  memories: Memory[];
  total: number;
};

export type MemoryStatsResponse = {
  ok: true;
  stats: {
    enabled: boolean;
    lastRunAt: number;
    fileCount: number;
    totalSize?: number;
    categories?: Record<string, number>;
  };
};

// ============================================
// Skill Types
// ============================================

export type Skill = {
  name: string;
  description: string;
  category: string;
  version: string;
  author: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
  parameters: Record<string, unknown>;
  source?: string;
};

export type SkillsResponse = {
  ok: true;
  skills: Skill[];
};

export type SkillDetailResponse = {
  ok: true;
  skill: Skill;
};

// ============================================
// Cron Job Types
// ============================================

export type CronJob = {
  id: string;
  name: string;
  schedule: string;
  naturalLanguage?: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt: number;
  trigger: {
    type: 'agent_ask' | 'tool_call' | 'webhook';
    data: unknown;
  };
  actions: Array<{
    type: 'memory_update' | 'send_message' | 'log_event';
    data: unknown;
  }>;
  executionHistory: Array<{
    runAt: number;
    duration: number;
    status: 'success' | 'error' | 'cancelled';
    error?: string;
  }>;
};

export type JobsResponse = {
  ok: true;
  jobs: CronJob[];
};

export type JobDetailResponse = {
  ok: true;
  job: CronJob;
};

// ============================================
// Session Types
// ============================================

export type Session = {
  key: string;
  channel: 'whatsapp' | 'cli' | 'web';
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
};

export type SessionMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  ts: number;
  toolCalls?: ToolCall[];
  providerId?: string;
  model?: string;
};

export type SessionsResponse = {
  ok: true;
  sessions: Session[];
};

export type SessionDetailResponse = {
  ok: true;
  sessionKey: string;
  messages: SessionMessage[];
};

// ============================================
// Event Types
// ============================================

export type SystemEvent = {
  id: string;
  timestamp: number;
  type:
    | 'message_received'
    | 'task_started'
    | 'task_completed'
    | 'agent_spawned'
    | 'agent_retired'
    | 'error_occurred'
    | 'memory_indexed'
    | 'cron_triggered'
    | 'tool_executed'
    | 'job_created'
    | 'job_started'
    | 'job_completed'
    | 'job_failed'
    | 'job_enabled'
    | 'job_disabled'
    | 'job_removed'
    | 'skill_created'
    | 'skill_deleted'
    | 'provider_cooldown'
    | 'provider_recovery'
    | 'status_updated'
    | 'status_snapshot'
    | 'status_delta'
    | 'task_created'
    | 'task_status_changed'
    | 'task_phase_changed'
    | 'task_progress_updated'
    | 'task_timeout_warning'
    | 'task_timeout'
    | 'task_retry_scheduled'
    | 'agent_event';
  data: Record<string, unknown>;
  severity: 'info' | 'warn' | 'error' | 'critical';
  source: 'agent' | 'system' | 'user';
  sessionKey?: string;
  channel?: string;
};

export type EventsResponse = {
  ok: true;
  events: SystemEvent[];
};

// ============================================
// System Health Types
// ============================================

export type SystemHealth = {
  cpu: number;
  memory: number;
  disk: number;
  uptime: number;
  lastRestart: number;
  queueDepth: number;
  activeConnections: number;
};

export type HealthResponse = {
  ok: true;
  health: SystemHealth;
};

// ============================================
// Status Response (Combined)
// ============================================

export type StatusResponse = {
  ok: true;
  time: number;
  runtime: { providers: ProviderInfo[] };
  queue: QueueLaneSnapshot[];
  running: MainTaskStatus[];
  subagents: SubagentRecord[];
  mainAgent?: {
    enabled: boolean;
    running: boolean;
    tasks?: Array<{
      id: string;
      description: string;
      status: "pending" | "queued" | "running" | "succeeded" | "failed" | "retrying" | "canceled";
      createdAt: number;
      completedAt?: number;
      result?: string;
    }>;
    lastCheckAt?: number | null;
    lastError?: string | null;
  };
  health?: SystemHealth;
};

// ============================================
// Config Types
// ============================================

export type ConfigResponse = {
  ok: true;
  path: string;
  config: Record<string, unknown>;
};

export type ConfigValidationResponse = {
  ok: boolean;
  errors?: Array<{
    path: string;
    message: string;
  }>;
};

// ============================================
// System Info Types
// ============================================

export type InstallStatusResponse = {
  ok: true;
  status: {
    node: string;
    platform: string;
    arch: string;
    playwright: {
      installed: boolean;
      executablePath: string;
    };
    logFile: string;
  };
};

export type WhatsAppStatusResponse = {
  ok: true;
  status: Record<string, unknown>;
};

// ============================================
// Logs Types
// ============================================

export type LogsResponse = {
  ok: true;
  lines: string[];
};

export type LogEntry = {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
};

// ============================================
// Tools Response (Toggles)
// ============================================

export type ToolsResponse = {
  ok: true;
  toggles: {
    memory: boolean;
    cliTools: boolean;
    subagents: boolean;
    browser: boolean;
  };
};

// ============================================
// WebSocket Message Types
// ============================================

export type WebSocketMessageType =
  | 'ping'
  | 'pong'
  | 'request'
  | 'response'
  | 'event'
  | 'subscribe'
  | 'unsubscribe';

export type WebSocketMessage = {
  id: string;
  type: WebSocketMessageType;
  payload: unknown;
  timestamp: number;
};

export type WebSocketEventPayload = {
  eventType: SystemEvent['type'];
  data: Record<string, unknown>;
};

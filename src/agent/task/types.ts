export type TaskState =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "canceled";

export type TaskPhase = "planning" | "executing" | "verifying";

export type TaskPriority = "high" | "normal" | "low";

export interface TaskStatusHistoryEntry {
  state: TaskState;
  at: number;
  reason?: string;
}

export interface TaskProgress {
  completed: number;
  total: number;
  lastUpdate: number;
  message?: string;
}

export interface TaskRetries {
  attempted: number;
  maxAttempts: number;
  nextRetryAt?: number;
  backoffMs?: number;
}

export interface TaskTimeout {
  startedAt: number;
  maxDurationMs: number;
  willExpireAt: number;
}

export interface TaskResult {
  content: string;
  toolsUsed: string[];
  iterations: number;
  providerId?: string;
  model?: string;
}

export interface TaskMetadata {
  channel: "whatsapp" | "cli" | "web" | "telegram" | "discord";
  priority: TaskPriority;
  tags: string[];
}

export interface TaskEntry {
  taskId: string;
  parentTaskId?: string;
  createdAt: number;
  updatedAt: number;
  status: TaskState;
  description: string;
  sessionKey: string;
  subagentSessionKey?: string;
  lane: "main" | "autonomous" | "maintenance";
  phase?: TaskPhase;
  progress?: TaskProgress;
  retries: TaskRetries;
  timeout?: TaskTimeout;
  result?: TaskResult;
  error?: string;
  metadata: TaskMetadata;
  history: TaskStatusHistoryEntry[];
}

export interface NewTaskInput {
  parentTaskId?: string;
  description: string;
  sessionKey: string;
  lane: TaskEntry["lane"];
  metadata: TaskMetadata;
  retries?: Partial<TaskRetries>;
  timeoutMs?: number;
}

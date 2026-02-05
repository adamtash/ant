/**
 * API Client
 * REST and WebSocket client for backend communication
 */

import type {
  StatusResponse,
  TasksResponse,
  TaskDetailResponse,
  MemorySearchResponse,
  MemoryIndexResponse,
  MemoryStatsResponse,
  SkillsResponse,
  SkillDetailResponse,
  JobsResponse,
  JobDetailResponse,
  SessionsResponse,
  SessionDetailResponse,
  ConfigResponse,
  ConfigValidationResponse,
  EnvResponse,
  EnvUpdateResponse,
  HealthResponse,
  ActionResponse,
  SystemEvent,
  LogsResponse,
  MainAgentTasksResponse,
  MainAgentTaskResponse,
} from './types';

// ============================================
// Base Fetch Helpers
// ============================================

export type ApiResult<T> = T & { ok: boolean };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PUT ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`DELETE ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

// ============================================
// Status & Health
// ============================================

export const getStatus = () => apiGet<StatusResponse>('/status');
export const getHealth = () => apiGet<HealthResponse>('/health');

// ============================================
// Error Classification
// ============================================

export const classifyError = (error: string, context?: Record<string, unknown>) =>
  apiPost<{
    ok: boolean;
    classification: {
      category: 'auth' | 'rate_limit' | 'timeout' | 'billing' | 'internal' | 'network' | 'validation' | 'unknown';
      severity: 'low' | 'medium' | 'high' | 'critical';
      retryable: boolean;
      provider?: string;
      confidence: number;
    };
  }>('/errors/classify', { error, context });

export const getErrorStats = () =>
  apiGet<{
    ok: boolean;
    stats: {
      totalErrors: number;
      lastErrorAt: number;
      errorRate: number;
    };
  }>('/errors/stats');

// ============================================
// Provider Health
// ============================================

export const getProviderHealth = () =>
  apiGet<{
    ok: boolean;
    providers: Array<{
      id: string;
      name: string;
      type: 'openai' | 'cli' | 'ollama';
      model: string;
      status: 'healthy' | 'degraded' | 'cooldown' | 'offline';
      stats: {
        requestCount: number;
        errorCount: number;
        successCount: number;
        avgResponseTime: number;
        errorRate: number;
        lastRequestAt?: number;
        lastErrorAt?: number;
      };
      cooldown?: {
        until: number;
        reason: string;
        startedAt: number;
      };
      lastSeen: number;
    }>;
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      cooldown: number;
      offline: number;
      overallErrorRate: number;
    };
  }>('/providers/health');

export const getProviderHealthById = (id: string) =>
  apiGet<{
    ok: boolean;
    provider: {
      id: string;
      name: string;
      type: 'openai' | 'cli' | 'ollama';
      model: string;
      status: 'healthy' | 'degraded' | 'cooldown' | 'offline';
      stats: {
        requestCount: number;
        errorCount: number;
        successCount: number;
        avgResponseTime: number;
        errorRate: number;
      };
    };
  }>(`/providers/health/${id}`);

// ============================================
// Tasks
// ============================================

export const getTasks = () => apiGet<TasksResponse>('/tasks');
export const getTasksPage = (params: { limit?: number; offset?: number } = {}) => {
  const limit = typeof params.limit === "number" ? params.limit : undefined;
  const offset = typeof params.offset === "number" ? params.offset : undefined;
  const qs = new URLSearchParams();
  if (limit !== undefined) qs.set("limit", String(limit));
  if (offset !== undefined) qs.set("offset", String(offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<TasksResponse>(`/tasks${suffix}`);
};
export const getTask = (id: string) => apiGet<TaskDetailResponse>(`/tasks/${encodeURIComponent(id)}`);
export const getTaskRaw = (id: string) => apiGet<unknown>(`/tasks/${encodeURIComponent(id)}`);
export const createTask = (prompt: string) =>
  apiPost<ActionResponse>('/tasks', { prompt });
export const cancelTask = (id: string) =>
  apiDelete<ActionResponse>(`/tasks/${id}`);

export const getSessionToolParts = (sessionKey: string) =>
  apiGet<{ ok: boolean; sessionKey: string; toolParts: unknown[] }>(
    `/sessions/${encodeURIComponent(sessionKey)}/tool-parts`
  );

// ============================================
// Agents
// ============================================

export interface AgentsApiResponse {
  ok: true;
  agents: Array<{
    id: string;
    caste: 'queen' | 'worker' | 'soldier' | 'nurse' | 'forager' | 'architect' | 'drone';
    name: string;
    status: 'spawning' | 'active' | 'thinking' | 'idle' | 'retired' | 'error';
    currentTask?: string;
    progress: number;
    toolsUsed: string[];
    taskCount: number;
    averageDuration: number;
    errorCount: number;
    createdAt: number;
    retiredAt?: number;
    parentAgentId?: string;
    metadata: {
      age: number;
      energy: number;
      specialization: string[];
    };
  }>;
}

export interface AgentDetailApiResponse {
  ok: true;
  agent: AgentsApiResponse['agents'][0];
}

export const getAgents = () => apiGet<AgentsApiResponse>('/agents');
export const getAgent = (id: string) => apiGet<AgentDetailApiResponse>(`/agents/${id}`);
export const spawnAgent = (caste: string, taskId?: string) =>
  apiPost<ActionResponse>('/agents', { caste, taskId });
export const terminateAgent = (id: string) =>
  apiDelete<ActionResponse>(`/agents/${id}`);

// ============================================
// Memory
// ============================================

export const searchMemory = (query: string) =>
  apiGet<MemorySearchResponse>(`/memory/search?q=${encodeURIComponent(query)}`);
export const getMemoryIndex = () => apiGet<MemoryIndexResponse>('/memory/index');
export const getMemoryIndexPage = (params: { limit?: number; offset?: number; category?: string; source?: string } = {}) => {
  const qs = new URLSearchParams();
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.offset === "number") qs.set("offset", String(params.offset));
  if (params.category) qs.set("category", params.category);
  if (params.source) qs.set("source", params.source);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<MemoryIndexResponse>(`/memory/index${suffix}`);
};
export const getMemoryStats = () => apiGet<MemoryStatsResponse>('/memory/stats');
export const addMemory = (content: string, category?: string, tags?: string[]) =>
  apiPost<ActionResponse>('/memory', { content, category, tags });
export const updateMemory = (id: string, content: string) =>
  apiPut<ActionResponse>(`/memory/${id}`, { content });
export const deleteMemory = (id: string) =>
  apiDelete<ActionResponse>(`/memory/${id}`);

// ============================================
// Skills
// ============================================

export const getSkills = () => apiGet<SkillsResponse>('/skills');
export const getSkill = (name: string) =>
  apiGet<SkillDetailResponse>(`/skills/${encodeURIComponent(name)}`);
export const createSkill = (name: string, description: string, source: string) =>
  apiPost<ActionResponse>('/skills', { name, description, source });
export const deleteSkill = (name: string) =>
  apiDelete<ActionResponse>(`/skills/${encodeURIComponent(name)}`);

// ============================================
// Jobs (Cron)
// ============================================

export const getJobs = () => apiGet<JobsResponse>('/jobs');
export const getJobsPage = (params: { limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.offset === "number") qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<JobsResponse>(`/jobs${suffix}`);
};
export const getJob = (id: string) => apiGet<JobDetailResponse>(`/jobs/${id}`);
export const createJob = (job: {
  name: string;
  schedule: string;
  trigger: { type: string; data: unknown };
  actions: Array<{ type: string; data: unknown }>;
}) => apiPost<ActionResponse>('/jobs', job);
export const updateJob = (id: string, updates: Record<string, unknown>) =>
  apiPut<ActionResponse>(`/jobs/${id}`, updates);
export const deleteJob = (id: string) => apiDelete<ActionResponse>(`/jobs/${id}`);
export const runJob = (id: string) => apiPost<ActionResponse>(`/jobs/${id}/run`);
export const toggleJob = (id: string) =>
  apiPost<ActionResponse>(`/jobs/${id}/toggle`);

// ============================================
// Sessions
// ============================================

export const getSessions = () => apiGet<SessionsResponse>('/sessions');
export const getSessionsPage = (params: { limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.offset === "number") qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<SessionsResponse>(`/sessions${suffix}`);
};
export const getSession = (key: string) =>
  apiGet<SessionDetailResponse>(`/sessions/${encodeURIComponent(key)}`);
export const deleteSession = (key: string) =>
  apiDelete<ActionResponse>(`/sessions/${encodeURIComponent(key)}`);

// ============================================
// Config
// ============================================

export const getConfig = () => apiGet<ConfigResponse>('/config');
export const updateConfig = (config: Record<string, unknown>) =>
  apiPost<ActionResponse>('/config', config); // Changed to POST
export const validateConfig = (config: Record<string, unknown>) =>
  apiPost<ConfigValidationResponse>('/config/validate', config);
export const dryRunConfigChanges = (changes: Record<string, unknown>) =>
  apiPost<Record<string, unknown>>("/config", { changes, dryRun: true });
export const applyConfigChanges = (changes: Record<string, unknown>) =>
  apiPost<Record<string, unknown>>("/config", { changes });

export const getEnv = () => apiGet<EnvResponse>("/env");
export const updateEnv = (updates: Record<string, string | null>) =>
  apiPost<EnvUpdateResponse>("/env", { updates });

// ============================================
// Main Agent
// ============================================

export const getMainAgentTasks = () =>
  apiGet<MainAgentTasksResponse>("/main-agent/tasks");
export const getMainAgentTask = (id: string) =>
  apiGet<MainAgentTaskResponse>(`/main-agent/tasks/${encodeURIComponent(id)}`);
export const assignMainAgentTask = (description: string) =>
  apiPost<ActionResponse>("/main-agent/tasks", { description });
export const pauseMainAgent = () => apiPost<ActionResponse>("/main-agent/pause");
export const resumeMainAgent = () => apiPost<ActionResponse>("/main-agent/resume");

// ============================================
// Channels
// ============================================

export interface ChannelResponse {
  ok: true;
  channels: Array<{
    id: string;
    status: {
      connected: boolean;
      selfJid?: string;
      qr?: string;
      message?: string;
      connectedAt?: number;
      messageCount?: number;
      lastMessageAt?: number;
      activeUsers?: number;
      responseTime?: number;
      errorRate?: number;
      [key: string]: any;
    };
  }>;
}

export const getChannels = () => apiGet<ChannelResponse>('/channels');

// ============================================
// Telegram Pairing
// ============================================

export interface TelegramPairingRequest {
  id: string;
  code: string;
  userId: string;
  chatId: string;
  username?: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface TelegramPairingSnapshotResponse {
  ok: true;
  allowFrom: string[];
  requests: TelegramPairingRequest[];
}

export interface TelegramPairingActionResponse {
  ok: boolean;
  error?: string;
  request?: TelegramPairingRequest;
  allowFrom?: string[];
}

export const getTelegramPairing = () => apiGet<TelegramPairingSnapshotResponse>('/telegram/pairing');
export const approveTelegramPairing = (code: string) =>
  apiPost<TelegramPairingActionResponse>('/telegram/pairing/approve', { code });
export const denyTelegramPairing = (code: string) =>
  apiPost<TelegramPairingActionResponse>('/telegram/pairing/deny', { code });
export const removeTelegramAllowFrom = (entry: string) =>
  apiPost<TelegramPairingActionResponse>('/telegram/pairing/remove', { entry });

// ============================================
// EventSource (SSE)
// ============================================

export function openLogStream(onMessage: (line: string) => void): EventSource {
  const source = new EventSource('/api/logs/stream');
  source.addEventListener('log', (event) => {
    if (event instanceof MessageEvent) {
      onMessage(event.data);
    }
  });
  return source;
}

export const getLogsPage = (params: { limit?: number; offset?: number } = {}) => {
  const qs = new URLSearchParams();
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.offset === "number") qs.set("offset", String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiGet<LogsResponse>(`/logs${suffix}`);
};

export function openEventStream(
  onEvent: (event: SystemEvent) => void
): EventSource {
  const source = new EventSource('/api/events/stream');
  source.addEventListener('event', (event) => {
    if (event instanceof MessageEvent) {
      try {
        const data = JSON.parse(event.data) as SystemEvent;
        onEvent(data);
      } catch (e) {
        console.error('Failed to parse event:', e);
      }
    }
  });
  return source;
}

// ============================================
// WebSocket Client
// ============================================

export type WebSocketHandler = {
  onEvent?: (event: SystemEvent) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
};

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: WebSocketHandler;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: number | null = null;

  constructor(url: string, handlers: WebSocketHandler) {
    this.url = url;
    this.handlers = handlers;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      console.log(`[WebSocket] Connecting to ${this.url}`);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log(`[WebSocket] Connected successfully`);
        this.reconnectAttempts = 0;
        this.handlers.onConnect?.();
        this.startPing();
      };

      this.ws.onclose = (event) => {
        console.warn(`[WebSocket] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.handlers.onDisconnect?.();
        this.stopPing();
        this.tryReconnect();
      };

      this.ws.onerror = (error) => {
        console.error(`[WebSocket] Error event:`, error);
        console.error(`[WebSocket] Connection state: readyState=${this.ws?.readyState}`);
        this.handlers.onError?.(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Reduce noise for high-frequency messages
          const isHighFrequency =
            message.payload?.type === 'status_updated' ||
            message.payload?.type === 'status_snapshot' ||
            message.payload?.type === 'status_delta' ||
            message.type === 'pong';
          if (!isHighFrequency) {
            console.log('[WebSocket] Received message:', { type: message.type, payload: message.payload });
          }
          
          if (message.type === 'event' && this.handlers.onEvent) {
            if (!isHighFrequency) {
              console.log('[WebSocket] Dispatching event to handler:', message.payload?.type);
            }
            this.handlers.onEvent(message.payload as SystemEvent);
          } else if (message.type === 'event' && !this.handlers.onEvent) {
            console.warn('[WebSocket] Event received but no onEvent handler registered');
          } else if (message.type === 'pong') {
            // Silently ignore pong messages (just keep-alive)
          } else if (!isHighFrequency) {
            console.log('[WebSocket] Ignoring message type:', message.type);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e, 'Raw data:', event.data);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection attempt failed:', error);
      console.error('[WebSocket] This usually means:', {
        url: this.url,
        message: error instanceof Error ? error.message : String(error),
      });
      this.tryReconnect();
    }
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          id: `msg-${Date.now()}`,
          type,
          payload,
          timestamp: Date.now(),
        })
      );
    }
  }

  private startPing(): void {
    this.pingInterval = window.setInterval(() => {
      this.send('ping', {});
    }, 300000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private tryReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * this.reconnectAttempts;
      console.log(`[WebSocket] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      setTimeout(() => {
        this.connect();
      }, delay);
    } else {
      console.error(`[WebSocket] Failed to reconnect after ${this.maxReconnectAttempts} attempts. Check that backend is running on ${this.url}`);
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ============================================
// API Client Singleton
// ============================================

let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(handlers: WebSocketHandler): WebSocketClient {
  if (!wsClient) {
    const wsUrl = `ws://${window.location.host}/api/ws`;
    console.log(`[WebSocket] Initializing client with URL: ${wsUrl}`);
    console.log(`[WebSocket] window.location.host: ${window.location.host}`);
    wsClient = new WebSocketClient(wsUrl, handlers);
  }
  return wsClient;
}

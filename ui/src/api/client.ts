/**
 * API Client
 * REST and WebSocket client for backend communication
 */

import type {
  StatusResponse,
  TasksResponse,
  TaskDetailResponse,
  AgentsResponse,
  AgentDetailResponse,
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
  HealthResponse,
  ActionResponse,
  SystemEvent,
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
// Tasks
// ============================================

export const getTasks = () => apiGet<TasksResponse>('/tasks');
export const getTask = (id: string) => apiGet<TaskDetailResponse>(`/tasks/${id}`);
export const createTask = (prompt: string) =>
  apiPost<ActionResponse>('/tasks', { prompt });
export const cancelTask = (id: string) =>
  apiDelete<ActionResponse>(`/tasks/${id}`);

// ============================================
// Agents
// ============================================

export const getAgents = () => apiGet<AgentsResponse>('/agents');
export const getAgent = (id: string) => apiGet<AgentDetailResponse>(`/agents/${id}`);
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
  apiPost<ActionResponse>('/config/validate', config);

// ============================================
// Channels
// ============================================

export const getChannels = () => apiGet<{ ok: boolean, channels: any[] }>('/channels');

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
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.handlers.onConnect?.();
        this.startPing();
      };

      this.ws.onclose = () => {
        this.handlers.onDisconnect?.();
        this.stopPing();
        this.tryReconnect();
      };

      this.ws.onerror = (error) => {
        this.handlers.onError?.(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'event' && this.handlers.onEvent) {
            this.handlers.onEvent(message.payload as SystemEvent);
          }
        } catch (e) {
          console.error('Failed to parse WebSocket message:', e);
        }
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
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
    }, 30000);
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
      setTimeout(() => {
        console.log(`Reconnecting... (attempt ${this.reconnectAttempts})`);
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
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
    wsClient = new WebSocketClient(wsUrl, handlers);
  }
  return wsClient;
}

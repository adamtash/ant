/**
 * System Store
 * Manages backend system data (tasks, agents, memory, errors)
 */

import { create } from 'zustand';

// Agent types matching backend
export type AgentCaste = 'queen' | 'worker' | 'soldier' | 'nurse' | 'forager' | 'architect' | 'drone';
export type AgentStatus = 'spawning' | 'active' | 'thinking' | 'idle' | 'retired' | 'error';

export interface Agent {
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
}

export interface Task {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  toolCalls: Array<{
    name: string;
    parameters: Record<string, unknown>;
    result: unknown;
    duration: number;
  }>;
  result?: string;
  error?: {
    message: string;
    stack: string;
    code: string;
  };
  subagents: Agent[];
  channel: 'whatsapp' | 'cli' | 'web' | 'telegram' | 'discord';
  sessionKey: string;
  iterations: number;
}

export interface Memory {
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
}

export interface CronJob {
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
}

export interface Skill {
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
}

export interface SystemEvent {
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
}

export interface SystemHealth {
  cpu: number;
  memory: number;
  disk: number;
  uptime: number;
  lastRestart: number;
  queueDepth: number;
  activeConnections: number;
}

export interface Session {
  key: string;
  channel: 'whatsapp' | 'cli' | 'web' | 'telegram' | 'discord';
  createdAt: number;
  lastMessageAt: number;
  messageCount: number;
}

export interface SystemState {
  // Connection
  isConnected: boolean;
  lastSync: number;

  // Main agent (queen)
  queenStatus: AgentStatus;
  queenThinking: boolean;

  // Entities
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  memories: Map<string, Memory>;
  jobs: Map<string, CronJob>;
  skills: Map<string, Skill>;
  sessions: Map<string, Session>;
  events: SystemEvent[];

  // Health
  health: SystemHealth;

  // Stats
  totalTasksCompleted: number;
  totalErrors: number;
  averageResponseTime: number;

  // Actions
  setConnected: (connected: boolean) => void;
  sync: () => Promise<void>;

  // Agent management
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  getAgent: (id: string) => Agent | undefined;

  // Task management
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  removeTask: (id: string) => void;
  getTask: (id: string) => Task | undefined;

  // Memory management
  addMemory: (memory: Memory) => void;
  updateMemory: (id: string, updates: Partial<Memory>) => void;
  removeMemory: (id: string) => void;
  searchMemory: (query: string) => Memory[];

  // Job management
  addJob: (job: CronJob) => void;
  updateJob: (id: string, updates: Partial<CronJob>) => void;
  removeJob: (id: string) => void;
  toggleJob: (id: string) => void;

  // Skill management
  addSkill: (skill: Skill) => void;
  updateSkill: (name: string, updates: Partial<Skill>) => void;
  removeSkill: (name: string) => void;

  // Events
  addEvent: (event: SystemEvent) => void;
  clearEvents: () => void;

  // Health
  updateHealth: (health: Partial<SystemHealth>) => void;
}

export const useSystemStore = create<SystemState>((set, get) => ({
  // Initial state
  isConnected: false,
  lastSync: 0,
  queenStatus: 'idle',
  queenThinking: false,
  agents: new Map(),
  tasks: new Map(),
  memories: new Map(),
  jobs: new Map(),
  skills: new Map(),
  sessions: new Map(),
  events: [],
  health: {
    cpu: 0,
    memory: 0,
    disk: 0,
    uptime: 0,
    lastRestart: 0,
    queueDepth: 0,
    activeConnections: 0,
  },
  totalTasksCompleted: 0,
  totalErrors: 0,
  averageResponseTime: 0,

  // Connection
  setConnected: (connected: boolean) => set({ isConnected: connected }),

  sync: async () => {
    // This would fetch from backend
    // For now, just update timestamp
    set({ lastSync: Date.now() });
  },

  // Agent management
  addAgent: (agent: Agent) => {
    const agents = new Map(get().agents);
    agents.set(agent.id, agent);
    set({ agents });
  },

  updateAgent: (id: string, updates: Partial<Agent>) => {
    const agents = new Map(get().agents);
    const agent = agents.get(id);
    if (agent) {
      agents.set(id, { ...agent, ...updates });
      set({ agents });
    }
  },

  removeAgent: (id: string) => {
    const agents = new Map(get().agents);
    agents.delete(id);
    set({ agents });
  },

  getAgent: (id: string) => get().agents.get(id),

  // Task management
  addTask: (task: Task) => {
    const tasks = new Map(get().tasks);
    tasks.set(task.id, task);
    set({ tasks });
  },

  updateTask: (id: string, updates: Partial<Task>) => {
    const tasks = new Map(get().tasks);
    const task = tasks.get(id);
    if (task) {
      const updated = { ...task, ...updates };
      tasks.set(id, updated);

      // Update stats
      if (updates.status === 'completed' && task.status !== 'completed') {
        set({
          tasks,
          totalTasksCompleted: get().totalTasksCompleted + 1,
        });
      } else if (updates.status === 'error' && task.status !== 'error') {
        set({
          tasks,
          totalErrors: get().totalErrors + 1,
        });
      } else {
        set({ tasks });
      }
    }
  },

  removeTask: (id: string) => {
    const tasks = new Map(get().tasks);
    tasks.delete(id);
    set({ tasks });
  },

  getTask: (id: string) => get().tasks.get(id),

  // Memory management
  addMemory: (memory: Memory) => {
    const memories = new Map(get().memories);
    memories.set(memory.id, memory);
    set({ memories });
  },

  updateMemory: (id: string, updates: Partial<Memory>) => {
    const memories = new Map(get().memories);
    const memory = memories.get(id);
    if (memory) {
      memories.set(id, { ...memory, ...updates, updatedAt: Date.now() });
      set({ memories });
    }
  },

  removeMemory: (id: string) => {
    const memories = new Map(get().memories);
    memories.delete(id);
    set({ memories });
  },

  searchMemory: (query: string) => {
    const memories = Array.from(get().memories.values());
    const lowerQuery = query.toLowerCase();

    return memories
      .filter(
        (m) =>
          m.content.toLowerCase().includes(lowerQuery) ||
          m.tags.some((t) => t.toLowerCase().includes(lowerQuery)) ||
          m.category.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => b.accessCount - a.accessCount);
  },

  // Job management
  addJob: (job: CronJob) => {
    const jobs = new Map(get().jobs);
    jobs.set(job.id, job);
    set({ jobs });
  },

  updateJob: (id: string, updates: Partial<CronJob>) => {
    const jobs = new Map(get().jobs);
    const job = jobs.get(id);
    if (job) {
      jobs.set(id, { ...job, ...updates });
      set({ jobs });
    }
  },

  removeJob: (id: string) => {
    const jobs = new Map(get().jobs);
    jobs.delete(id);
    set({ jobs });
  },

  toggleJob: (id: string) => {
    const jobs = new Map(get().jobs);
    const job = jobs.get(id);
    if (job) {
      jobs.set(id, { ...job, enabled: !job.enabled });
      set({ jobs });
    }
  },

  // Skill management
  addSkill: (skill: Skill) => {
    const skills = new Map(get().skills);
    skills.set(skill.name, skill);
    set({ skills });
  },

  updateSkill: (name: string, updates: Partial<Skill>) => {
    const skills = new Map(get().skills);
    const skill = skills.get(name);
    if (skill) {
      skills.set(name, { ...skill, ...updates, updatedAt: Date.now() });
      set({ skills });
    }
  },

  removeSkill: (name: string) => {
    const skills = new Map(get().skills);
    skills.delete(name);
    set({ skills });
  },

  // Events
  addEvent: (event: SystemEvent) => {
    const events = [...get().events, event];
    // Keep last 500 events
    if (events.length > 500) {
      events.shift();
    }
    set({ events });
  },

  clearEvents: () => set({ events: [] }),

  // Health
  updateHealth: (health: Partial<SystemHealth>) => {
    set({ health: { ...get().health, ...health } });
  },
}));

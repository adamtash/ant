export type ProviderInfo = {
  label: string;
  id: string;
  type: "openai" | "cli";
  model: string;
  baseUrl: string;
  cliProvider?: string;
};

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

export type ActionResponse = {
  ok: boolean;
  error?: string;
  hint?: string;
};


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

export type StatusResponse = {
  ok: true;
  time: number;
  runtime: { providers: ProviderInfo[] };
  queue: QueueLaneSnapshot[];
  running: MainTaskStatus[];
  subagents: SubagentRecord[];
};

export type LogsResponse = {
  ok: true;
  lines: string[];
};

export type SessionsResponse = {
  ok: true;
  sessions: { sessionKey: string; updatedAt: number }[];
};

export type SessionDetailResponse = {
  ok: true;
  sessionKey: string;
  messages: { role: string; content: string; ts: number }[];
};

export type ToolsResponse = {
  ok: true;
  toggles: {
    memory: boolean;
    cliTools: boolean;
    subagents: boolean;
    browser: boolean;
  };
};

export type ConfigResponse = {
  ok: true;
  path: string;
  config: Record<string, any>;
};

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

export type MemoryStatsResponse = {
  ok: true;
  stats: {
    enabled: boolean;
    lastRunAt: number;
    fileCount: number;
  };
};

export type WhatsAppStatusResponse = {
  ok: true;
  status: Record<string, unknown>;
};

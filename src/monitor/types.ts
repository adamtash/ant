/**
 * Types for the Monitoring & Observability System
 *
 * This file defines all TypeScript interfaces for events, metrics,
 * and alerting in the ANT agent monitoring system.
 */

import type { Channel } from "../agent/types.js";

// ============================================================================
// Event Types
// ============================================================================

/**
 * All supported event types in the system
 */
export type EventType =
  | "message_received"
  | "tool_executed"
  | "agent_thinking"
  | "subagent_spawned"
  | "cron_triggered"
  | "error_occurred"
  | "memory_indexed"
  | "session_started"
  | "session_ended";

/**
 * Error severity levels
 */
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

/**
 * Base event structure stored in the event store
 */
export interface BaseEvent {
  id: string;
  type: EventType;
  timestamp: number;
  sessionKey?: string;
  channel?: Channel;
}

/**
 * Event data payloads for each event type
 */
export interface MessageReceivedData {
  sender: string;
  contentPreview: string;
  messageLength: number;
}

export interface ToolExecutedData {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  args?: Record<string, unknown>;
}

export interface AgentThinkingData {
  iterationCount: number;
  toolsUsed: string[];
  elapsed: number;
}

export interface SubagentSpawnedData {
  subagentId: string;
  task: string;
  parentSessionKey?: string;
}

export interface CronTriggeredData {
  jobId: string;
  jobName: string;
  schedule: string;
}

export interface ErrorOccurredData {
  errorType: string;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface MemoryIndexedData {
  itemsCount: number;
  source: "memory" | "sessions";
  duration: number;
}

export interface SessionStartedData {
  initialMessage?: string;
  source?: string;
}

export interface SessionEndedData {
  duration: number;
  messagesCount: number;
  toolsUsed: string[];
}

/**
 * Union of all event data types
 */
export type EventData =
  | MessageReceivedData
  | ToolExecutedData
  | AgentThinkingData
  | SubagentSpawnedData
  | CronTriggeredData
  | ErrorOccurredData
  | MemoryIndexedData
  | SessionStartedData
  | SessionEndedData
  | Record<string, unknown>;

/**
 * Full event with typed data
 */
export interface MonitorEvent<T extends EventData = EventData> extends BaseEvent {
  data: T;
}

/**
 * Stored event format (data serialized as JSON string)
 */
export interface StoredEvent {
  id: string;
  type: EventType;
  timestamp: number;
  sessionKey: string | null;
  channel: string | null;
  data: string;
}

// ============================================================================
// Event Query Types
// ============================================================================

/**
 * Options for querying events
 */
export interface EventQueryOptions {
  type?: EventType | EventType[];
  sessionKey?: string;
  channel?: Channel;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
  orderBy?: "timestamp" | "type";
  orderDirection?: "asc" | "desc";
}

/**
 * Result from event queries
 */
export interface EventQueryResult<T extends EventData = EventData> {
  events: MonitorEvent<T>[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Time-based aggregation period
 */
export type AggregationPeriod = "minute" | "hour" | "day" | "week";

/**
 * Aggregated event count
 */
export interface EventCount {
  period: string;
  count: number;
}

/**
 * Tool usage statistics
 */
export interface ToolUsageStats {
  name: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  avgDuration: number;
  avgMessagesPerSession: number;
}

/**
 * Error statistics
 */
export interface ErrorStats {
  totalErrors: number;
  bySeverity: Record<ErrorSeverity, number>;
  byType: Record<string, number>;
  recentErrors: MonitorEvent<ErrorOccurredData>[];
}

/**
 * Overall system metrics
 */
export interface SystemMetrics {
  eventsPerHour: EventCount[];
  toolUsage: ToolUsageStats[];
  sessionStats: SessionStats;
  errorStats: ErrorStats;
  topErrors: Array<{ type: string; count: number }>;
  uptime: number;
}

// ============================================================================
// Alerter Types
// ============================================================================

/**
 * Alert channel types
 */
export type AlertChannel = "console" | "file" | "whatsapp" | "webhook";

/**
 * Alert configuration
 */
export interface AlertConfig {
  /** Whether alerting is enabled */
  enabled: boolean;

  /** Alert channels to use */
  channels: AlertChannel[];

  /** Error threshold before alert is triggered */
  errorThreshold: number;

  /** Time window for error threshold in milliseconds */
  errorWindowMs: number;

  /** Cooldown period between alerts in milliseconds */
  cooldownMs: number;

  /** Alert file path (if using file channel) */
  alertFilePath?: string;

  /** Webhook URL (if using webhook channel) */
  webhookUrl?: string;

  /** WhatsApp recipient JIDs (if using whatsapp channel) */
  whatsappRecipients?: string[];

  /** Minimum severity to trigger alerts */
  minSeverity: ErrorSeverity;
}

/**
 * Alert payload
 */
export interface Alert {
  id: string;
  timestamp: number;
  type: "error_threshold" | "critical_error" | "system_health";
  severity: ErrorSeverity;
  title: string;
  message: string;
  context: {
    errorCount?: number;
    timeWindowMs?: number;
    recentErrors?: string[];
    [key: string]: unknown;
  };
}

/**
 * Alert handler function signature
 */
export type AlertHandler = (alert: Alert) => Promise<void>;

// ============================================================================
// Event Store Configuration
// ============================================================================

/**
 * Event store configuration
 */
export interface EventStoreConfig {
  /** SQLite database path */
  dbPath: string;

  /** Number of days to retain events (default: 30) */
  retentionDays: number;

  /** Whether to run cleanup on startup */
  cleanupOnStartup: boolean;

  /** Cleanup interval in hours (0 to disable) */
  cleanupIntervalHours: number;
}

// ============================================================================
// Event Stream Types
// ============================================================================

/**
 * Event listener callback
 */
export type EventListener<T extends EventData = EventData> = (
  event: MonitorEvent<T>,
) => void | Promise<void>;

/**
 * Unsubscribe function returned by subscribe
 */
export type Unsubscribe = () => void;

/**
 * Event filter predicate
 */
export type EventFilter<T extends EventData = EventData> = (
  event: MonitorEvent<T>,
) => boolean;

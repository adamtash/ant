/**
 * Types for the Monitoring & Observability System
 *
 * This file defines all TypeScript interfaces for events, metrics,
 * and alerting in the ANT agent monitoring system.
 */

import type { Channel, ToolPart } from "../agent/types.js";

// ============================================================================
// Event Types
// ============================================================================

/**
 * All supported event types in the system
 */
export type EventType =
  | "message_received"
  | "message_queued"
  | "message_processing"
  | "message_processed"
  | "message_dropped"
  | "message_timeout"
  | "tool_executing"
  | "tool_executed"
  | "tool_part_updated"
  | "agent_thinking"
  | "agent_response"
  | "subagent_spawned"
  | "cron_triggered"
  | "error_occurred"
  | "memory_indexed"
  | "session_started"
  | "session_ended"
  | "main_agent_status_changed"
  | "job_created"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_enabled"
  | "job_disabled"
  | "job_removed"
  | "skill_created"
  | "skill_deleted"
  | "provider_cooldown"
  | "provider_recovery";

/**
 * Error severity levels
 */
export type ErrorSeverity = "low" | "medium" | "high" | "critical";

/**
 * Error categories for classification
 */
export type ErrorCategory =
  | "auth"
  | "rate_limit"
  | "timeout"
  | "billing"
  | "internal"
  | "network"
  | "validation"
  | "unknown";

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

export interface MessageQueuedData {
  queueLength: number;
  position: number;
  priority?: string;
}

export interface MessageProcessingData {
  handler?: string;
}

export interface MessageProcessedData {
  duration: number;
  success: boolean;
  responsePreview?: string;
}

export interface MessageDroppedData {
  reason: string;
}

export interface MessageTimeoutData {
  duration: number;
  stage: string;
}

export interface ToolExecutingData {
  name: string;
  args?: Record<string, unknown>;
}

export interface ToolExecutedData {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
  args?: Record<string, unknown>;
}

export interface ToolPartUpdatedData {
  toolPart: ToolPart;
}

export interface AgentThinkingData {
  query?: string;
  inferredTopic?: string;
  iterationCount?: number;
  toolsUsed?: string[];
  elapsed?: number;
}

export interface AgentResponseData {
  iterations: number;
  toolsUsed: string[];
  duration: number;
  success: boolean;
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
  category?: ErrorCategory;
  retryable?: boolean;
  provider?: string;
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

export interface MainAgentStatusData {
  healthStatus: "healthy" | "degraded" | "unhealthy";
  successRate: string | null;
  failureCount: number;
  consecutiveFailures: number;
  lastTaskAt: number | null;
}

export interface JobCreatedData {
  jobId: string;
  name: string;
  schedule: string;
  triggerType: string;
}

export interface JobStartedData {
  jobId: string;
  name: string;
  schedule: string;
  triggeredAt: number;
}

export interface JobCompletedData {
  jobId: string;
  name: string;
  duration: number;
  retryCount: number;
}

export interface JobFailedData {
  jobId: string;
  name: string;
  duration: number;
  error: string;
  retryCount: number;
}

export interface JobEnabledData {
  jobId: string;
  name: string;
}

export interface JobDisabledData {
  jobId: string;
  name: string;
}

export interface JobRemovedData {
  jobId: string;
  name: string;
}

export interface SkillCreatedData {
  name: string;
  description: string;
  author: string;
}

export interface SkillDeletedData {
  name: string;
}

export interface ProviderCooldownData {
  providerId: string;
  providerName: string;
  reason: "rate_limit" | "quota" | "auth" | "maintenance" | "error";
  until: number;
}

export interface ProviderRecoveryData {
  providerId: string;
  providerName: string;
  recoveredAt: number;
}

/**
 * Union of all event data types
 */
export type EventData =
  | MessageReceivedData
  | MessageQueuedData
  | MessageProcessingData
  | MessageProcessedData
  | MessageDroppedData
  | MessageTimeoutData
  | ToolExecutingData
  | ToolExecutedData
  | ToolPartUpdatedData
  | AgentThinkingData
  | AgentResponseData
  | SubagentSpawnedData
  | CronTriggeredData
  | ErrorOccurredData
  | MemoryIndexedData
  | SessionStartedData
  | SessionEndedData
  | MainAgentStatusData
  | JobCreatedData
  | JobStartedData
  | JobCompletedData
  | JobFailedData
  | JobEnabledData
  | JobDisabledData
  | JobRemovedData
  | SkillCreatedData
  | SkillDeletedData
  | ProviderCooldownData
  | ProviderRecoveryData
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

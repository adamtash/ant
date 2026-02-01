/**
 * Scheduler Types - Type definitions for the cron scheduling system
 *
 * This module defines all types used by the scheduler, job store, and executor.
 */

import type { Channel } from "../agent/types.js";
import type { Logger } from "../log.js";
import type { ScheduledTask } from "node-cron";

// ============================================================================
// Trigger Types
// ============================================================================

/**
 * Agent ask trigger - invokes the agent with a prompt
 */
export interface AgentAskTrigger {
  type: "agent_ask";
  prompt: string;
}

/**
 * Tool call trigger - directly calls a tool
 */
export interface ToolCallTrigger {
  type: "tool_call";
  tool: string;
  args?: Record<string, unknown>;
}

/**
 * Webhook trigger - calls an external webhook
 */
export interface WebhookTrigger {
  type: "webhook";
  url: string;
  method?: "GET" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
}

export type JobTrigger = AgentAskTrigger | ToolCallTrigger | WebhookTrigger;

// ============================================================================
// Action Types
// ============================================================================

/**
 * Memory update action - stores result in memory
 */
export interface MemoryUpdateAction {
  type: "memory_update";
  key?: string;
  tags?: string[];
}

/**
 * Send message action - sends result to a channel
 */
export interface SendMessageAction {
  type: "send_message";
  channel: Channel;
  recipient: string;
}

/**
 * Log event action - logs the result
 */
export interface LogEventAction {
  type: "log_event";
  level?: "info" | "warn" | "error";
  prefix?: string;
}

export type JobAction = MemoryUpdateAction | SendMessageAction | LogEventAction;

// ============================================================================
// Job Definition
// ============================================================================

/**
 * Scheduled job definition stored in jobs.json
 */
export interface ScheduledJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string; // Cron expression
  trigger: JobTrigger;
  actions: JobAction[];
  retryOnFailure: boolean;
  maxRetries: number;
  timeout: number; // milliseconds
  lastRun?: number;
  lastResult?: JobResult;
  createdAt: number;
  updatedAt: number;
}

/**
 * Job result tracking
 */
export interface JobResult {
  status: "success" | "failure";
  completedAt: number;
  duration: number;
  error?: string;
  output?: unknown;
  retryCount?: number;
}

/**
 * Jobs file structure
 */
export interface JobsFile {
  version: number;
  jobs: ScheduledJob[];
}

// ============================================================================
// Executor Types
// ============================================================================

/**
 * Job execution context
 */
export interface JobExecutionContext {
  job: ScheduledJob;
  triggeredAt: number;
  retryCount: number;
  logger: Logger;
}

/**
 * Job execution result
 */
export interface JobExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

/**
 * Agent executor function type
 */
export type AgentExecutor = (params: {
  sessionKey: string;
  query: string;
  cronContext: {
    jobId: string;
    jobName: string;
    schedule: string;
    triggeredAt: number;
  };
}) => Promise<{ response: string; error?: string }>;

/**
 * Tool executor function type
 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

/**
 * Message sender function type
 */
export type MessageSender = (params: {
  channel: Channel;
  recipient: string;
  content: string;
}) => Promise<void>;

/**
 * Memory updater function type
 */
export type MemoryUpdater = (params: {
  key: string;
  content: string;
  tags?: string[];
}) => Promise<void>;

// ============================================================================
// Scheduler Types
// ============================================================================

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  stateDir: string;
  logger: Logger;
  agentExecutor?: AgentExecutor;
  toolExecutor?: ToolExecutor;
  messageSender?: MessageSender;
  memoryUpdater?: MemoryUpdater;
}

/**
 * Running job instance
 */
export interface RunningJob {
  id: string;
  task: ScheduledTask;
  job: ScheduledJob;
}

/**
 * Scheduler events
 */
export type SchedulerEventType =
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "job_added"
  | "job_removed"
  | "job_enabled"
  | "job_disabled"
  | "scheduler_started"
  | "scheduler_stopped";

export interface SchedulerEvent {
  type: SchedulerEventType;
  timestamp: number;
  jobId?: string;
  data?: Record<string, unknown>;
}

export type SchedulerEventHandler = (event: SchedulerEvent) => void;

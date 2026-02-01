/**
 * Gateway Types - WebSocket control plane types
 */

import type { Channel, NormalizedMessage } from "../agent/types.js";

/**
 * Gateway connection state
 */
export interface GatewayConnection {
  id: string;
  channel: Channel;
  sessionKey: string;
  connectedAt: number;
  lastMessageAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Gateway event types
 */
export type GatewayEventType =
  | "connection"
  | "disconnection"
  | "message"
  | "response"
  | "tool_call"
  | "tool_result"
  | "error"
  | "status"
  | "task_started"
  | "task_completed"
  | "error_occurred";

/**
 * Gateway event
 */
export interface GatewayEvent {
  id?: string;
  type: GatewayEventType;
  connectionId?: string;
  sessionKey?: string;
  channel?: Channel;
  timestamp: number;
  data: unknown;
}

/**
 * Gateway message (WebSocket protocol)
 */
export interface GatewayMessage {
  id: string;
  type: "request" | "response" | "event" | "ping" | "pong";
  payload: unknown;
  timestamp: number;
}

/**
 * Gateway request types
 */
export type GatewayRequestType =
  | "send_message"
  | "subscribe"
  | "unsubscribe"
  | "get_status"
  | "list_sessions"
  | "get_session"
  | "execute_tool"
  | "run_task";

/**
 * Gateway request
 */
export interface GatewayRequest {
  id: string;
  type: GatewayRequestType;
  payload: Record<string, unknown>;
}

/**
 * Gateway response
 */
export interface GatewayResponse {
  id: string;
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Gateway status
 */
export interface GatewayStatus {
  connected: boolean;
  uptime: number;
  connections: number;
  activeSessions: number;
  queueDepth: number;
  channels: Record<string, any>;
}

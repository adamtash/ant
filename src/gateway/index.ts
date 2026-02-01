/**
 * Gateway Module - WebSocket control plane
 */

export { GatewayServer, type GatewayConfig } from "./server.js";
export { EventBus } from "./event-bus.js";
export { SessionManager, type SessionContext, type SessionMessage } from "./session-manager.js";
export type {
  GatewayConnection,
  GatewayEventType,
  GatewayEvent,
  GatewayMessage,
  GatewayRequestType,
  GatewayRequest,
  GatewayResponse,
  GatewayStatus,
} from "./types.js";

/**
 * Gateway Server - WebSocket control plane for the ANT agent
 *
 * Features:
 * - WebSocket server for real-time communication
 * - Session management across channels
 * - Event pub/sub
 * - Request/response handling
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Channel } from "../agent/types.js";
import type { Logger } from "../log.js";
import { EventBus } from "./event-bus.js";
import { SessionManager } from "./session-manager.js";
import type {
  GatewayConnection,
  GatewayEvent,
  GatewayMessage,
  GatewayRequest,
  GatewayResponse,
  GatewayStatus,
} from "./types.js";

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  port: number;
  host?: string;
  stateDir: string;
}

/**
 * Gateway Server - Main WebSocket control plane
 */
export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private connections: Map<string, { ws: WebSocket; connection: GatewayConnection }> = new Map();
  private readonly config: GatewayConfig;
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  private readonly sessions: SessionManager;
  private startTime: number = 0;

  constructor(params: {
    config: GatewayConfig;
    logger: Logger;
  }) {
    this.config = params.config;
    this.logger = params.logger.child({ component: "gateway" });
    this.eventBus = new EventBus(this.logger);
    this.sessions = new SessionManager({
      stateDir: params.config.stateDir,
      logger: this.logger,
    });
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    if (this.wss) {
      this.logger.warn("Gateway already running");
      return;
    }

    this.startTime = Date.now();

    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host || "127.0.0.1",
    });

    this.wss.on("connection", (ws, request) => {
      this.handleConnection(ws, request);
    });

    this.wss.on("error", (error) => {
      this.logger.error({ error: error.message }, "Gateway server error");
    });

    this.logger.info({ port: this.config.port }, "Gateway server started");
  }

  /**
   * Stop the gateway server
   */
  async stop(): Promise<void> {
    if (!this.wss) return;

    // Close all connections
    for (const { ws } of this.connections.values()) {
      ws.close(1000, "Server shutting down");
    }
    this.connections.clear();

    // Close server
    await new Promise<void>((resolve, reject) => {
      this.wss!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    this.wss = null;
    this.logger.info("Gateway server stopped");
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const connectionId = this.generateId();
    const sessionKey = this.extractSessionKey(request) || `ws-${connectionId}`;
    const channel = this.extractChannel(request) || "web";

    const connection: GatewayConnection = {
      id: connectionId,
      channel,
      sessionKey,
      connectedAt: Date.now(),
      lastMessageAt: Date.now(),
    };

    this.connections.set(connectionId, { ws, connection });

    this.logger.info({ connectionId, sessionKey, channel }, "Client connected");

    // Emit connection event
    this.eventBus.emit({
      type: "connection",
      connectionId,
      sessionKey,
      channel,
      timestamp: Date.now(),
      data: { remoteAddress: request.socket.remoteAddress },
    });

    // Set up message handler
    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as GatewayMessage;
        await this.handleMessage(connectionId, message);
      } catch (err) {
        this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Message parse error");
        this.sendError(ws, "Invalid message format");
      }
    });

    // Set up close handler
    ws.on("close", (code, reason) => {
      this.connections.delete(connectionId);
      this.logger.info({ connectionId, code, reason: reason.toString() }, "Client disconnected");

      this.eventBus.emit({
        type: "disconnection",
        connectionId,
        sessionKey,
        channel,
        timestamp: Date.now(),
        data: { code, reason: reason.toString() },
      });
    });

    // Set up error handler
    ws.on("error", (error) => {
      this.logger.error({ connectionId, error: error.message }, "WebSocket error");
    });

    // Send welcome message
    this.send(ws, {
      id: this.generateId(),
      type: "event",
      payload: {
        type: "connected",
        connectionId,
        sessionKey,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(connectionId: string, message: GatewayMessage): Promise<void> {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.connection.lastMessageAt = Date.now();

    switch (message.type) {
      case "ping":
        this.send(conn.ws, {
          id: this.generateId(),
          type: "pong",
          payload: null,
          timestamp: Date.now(),
        });
        break;

      case "request":
        await this.handleRequest(conn.ws, conn.connection, message.payload as GatewayRequest);
        break;

      default:
        this.logger.warn({ type: message.type }, "Unknown message type");
    }
  }

  /**
   * Handle request
   */
  private async handleRequest(
    ws: WebSocket,
    connection: GatewayConnection,
    request: GatewayRequest
  ): Promise<void> {
    let response: GatewayResponse;

    try {
      switch (request.type) {
        case "get_status":
          response = {
            id: this.generateId(),
            requestId: request.id,
            success: true,
            data: this.getStatus(),
          };
          break;

        case "list_sessions":
          response = {
            id: this.generateId(),
            requestId: request.id,
            success: true,
            data: this.sessions.list(),
          };
          break;

        case "get_session":
          const sessionKey = request.payload.sessionKey as string;
          response = {
            id: this.generateId(),
            requestId: request.id,
            success: true,
            data: this.sessions.get(sessionKey),
          };
          break;

        default:
          response = {
            id: this.generateId(),
            requestId: request.id,
            success: false,
            error: `Unknown request type: ${request.type}`,
          };
      }
    } catch (err) {
      response = {
        id: this.generateId(),
        requestId: request.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    this.send(ws, {
      id: response.id,
      type: "response",
      payload: response,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast event to all connections
   */
  broadcast(event: GatewayEvent): void {
    const message: GatewayMessage = {
      id: this.generateId(),
      type: "event",
      payload: event,
      timestamp: Date.now(),
    };

    for (const { ws, connection } of this.connections.values()) {
      // Only send to relevant sessions
      if (event.sessionKey && connection.sessionKey !== event.sessionKey) {
        continue;
      }
      this.send(ws, message);
    }
  }

  /**
   * Send message to specific connection
   */
  private send(ws: WebSocket, message: GatewayMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to connection
   */
  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      id: this.generateId(),
      type: "event",
      payload: { type: "error", error },
      timestamp: Date.now(),
    });
  }

  /**
   * Get gateway status
   */
  getStatus(): GatewayStatus {
    return {
      connected: this.wss !== null,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      connections: this.connections.size,
      activeSessions: this.sessions.activeCount,
      queueDepth: 0, // TODO: Implement queue
      channels: {
        whatsapp: { enabled: true, connected: false },
        cli: { enabled: true, connected: true },
        web: { enabled: true, connected: this.connections.size > 0 },
        telegram: { enabled: false, connected: false },
        discord: { enabled: false, connected: false },
      },
    };
  }

  /**
   * Get event bus
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * Get session manager
   */
  getSessionManager(): SessionManager {
    return this.sessions;
  }

  /**
   * Extract session key from request headers/query
   */
  private extractSessionKey(request: IncomingMessage): string | null {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    return url.searchParams.get("sessionKey") || null;
  }

  /**
   * Extract channel from request headers/query
   */
  private extractChannel(request: IncomingMessage): Channel | null {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const channel = url.searchParams.get("channel");
    if (channel && ["whatsapp", "cli", "web", "telegram", "discord"].includes(channel)) {
      return channel as Channel;
    }
    return null;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

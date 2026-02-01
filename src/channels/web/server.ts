/**
 * Web Server for Web Channel Adapter
 *
 * Express-based HTTP server that provides:
 * - REST API for sending/receiving messages
 * - WebSocket support for real-time updates
 * - Session management via cookies/headers
 */

import http from "node:http";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type { Logger } from "../../log.js";
import type { NormalizedMessage, SendResult } from "../types.js";

// ============================================================================
// Configuration
// ============================================================================

export interface WebServerConfig {
  /** Logger instance */
  logger: Logger;

  /** Port to listen on */
  port: number;

  /** Host to bind to */
  host: string;

  /** CORS origin (default: *) */
  corsOrigin?: string;

  /** API key for authentication (optional) */
  apiKey?: string;

  /** Session cookie name */
  sessionCookieName?: string;

  /** Enable WebSocket support */
  enableWebSocket?: boolean;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface WebMessageRequest {
  content: string;
  sessionId?: string;
  threadId?: string;
  sender?: {
    id?: string;
    name?: string;
  };
  media?: {
    type: "image" | "video" | "audio" | "file";
    data: string; // base64 encoded
    mimeType?: string;
    filename?: string;
  };
  priority?: "high" | "normal" | "low";
}

export interface WebMessageResponse {
  ok: boolean;
  messageId?: string;
  error?: string;
  timestamp?: number;
}

export interface WebSessionInfo {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
}

// ============================================================================
// WebSocket Types
// ============================================================================

interface WebSocketClient {
  id: string;
  sessionId: string;
  ws: WebSocket;
  lastPing: number;
}

// ============================================================================
// Web Server
// ============================================================================

export class WebServer extends EventEmitter {
  private readonly logger: Logger;
  private readonly config: WebServerConfig;
  private server: http.Server | null = null;
  private readonly sessions: Map<string, WebSessionInfo> = new Map();
  private readonly wsClients: Map<string, WebSocketClient> = new Map();
  private readonly pendingResponses: Map<string, (message: NormalizedMessage) => void> = new Map();

  constructor(config: WebServerConfig) {
    super();
    this.config = config;
    this.logger = config.logger.child({ component: "web-server" });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.logger.error({ error: String(err) }, "Request handler error");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.logger.info(
          { host: this.config.host, port: this.config.port },
          "Web server started"
        );
        resolve();
      });

      this.server!.on("error", (err) => {
        this.logger.error({ error: String(err) }, "Server error");
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const client of this.wsClients.values()) {
      try {
        client.ws.close();
      } catch {
        // ignore
      }
    }
    this.wsClients.clear();

    // Close HTTP server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.logger.info("Web server stopped");
          this.server = null;
          resolve();
        });
      });
    }
  }

  // ==========================================================================
  // Request Handling
  // ==========================================================================

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Set CORS headers
    const origin = this.config.corsOrigin ?? "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Session-ID");

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Check authentication
    if (this.config.apiKey && !this.checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    // Route requests
    if (path === "/api/messages" && req.method === "POST") {
      await this.handleSendMessage(req, res);
    } else if (path === "/api/sessions" && req.method === "GET") {
      this.handleGetSessions(res);
    } else if (path.startsWith("/api/sessions/") && req.method === "GET") {
      const sessionId = path.split("/")[3];
      this.handleGetSession(sessionId, res);
    } else if (path === "/api/health" && req.method === "GET") {
      this.handleHealth(res);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
    }
  }

  private checkAuth(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader) return false;

    if (authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7) === this.config.apiKey;
    }

    return authHeader === this.config.apiKey;
  }

  // ==========================================================================
  // API Handlers
  // ==========================================================================

  private async handleSendMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      const body = await this.readBody(req);
      const request = JSON.parse(body) as WebMessageRequest;

      if (!request.content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Missing content" }));
        return;
      }

      // Get or create session
      const sessionId = request.sessionId ?? this.getSessionFromRequest(req) ?? randomUUID();
      this.updateSession(sessionId);

      // Create normalized message
      const message: NormalizedMessage = {
        id: randomUUID(),
        channel: "web",
        sender: {
          id: request.sender?.id ?? sessionId,
          name: request.sender?.name ?? "Web User",
          isAgent: false,
        },
        content: request.content,
        media: request.media
          ? {
              type: request.media.type,
              data: Buffer.from(request.media.data, "base64"),
              mimeType: request.media.mimeType,
              filename: request.media.filename,
            }
          : undefined,
        context: {
          sessionKey: `web:${sessionId}`,
          chatId: sessionId,
          threadId: request.threadId,
        },
        timestamp: Date.now(),
        priority: request.priority ?? "normal",
      };

      // Emit message event
      this.emit("message", message);

      // Return success response
      const response: WebMessageResponse = {
        ok: true,
        messageId: message.id,
        timestamp: message.timestamp,
      };

      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId,
      });
      res.end(JSON.stringify(response));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ error }, "Failed to handle message request");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error }));
    }
  }

  private handleGetSessions(res: http.ServerResponse): void {
    const sessions = Array.from(this.sessions.values());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions }));
  }

  private handleGetSession(sessionId: string, res: http.ServerResponse): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Session not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, session }));
  }

  private handleHealth(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        status: "healthy",
        sessions: this.sessions.size,
        wsClients: this.wsClients.size,
      })
    );
  }

  // ==========================================================================
  // Outbound Messages
  // ==========================================================================

  /**
   * Send a message to a web client
   */
  async sendToSession(sessionId: string, message: NormalizedMessage): Promise<SendResult> {
    // Try WebSocket first
    const wsClient = this.findWsClientBySession(sessionId);
    if (wsClient) {
      try {
        wsClient.ws.send(
          JSON.stringify({
            type: "message",
            message: this.serializeMessage(message),
          })
        );
        return { ok: true, messageId: message.id, timestamp: Date.now() };
      } catch (err) {
        this.logger.warn({ error: String(err) }, "WebSocket send failed");
      }
    }

    // Check for pending response callback
    const callback = this.pendingResponses.get(sessionId);
    if (callback) {
      callback(message);
      this.pendingResponses.delete(sessionId);
      return { ok: true, messageId: message.id, timestamp: Date.now() };
    }

    // No active connection - message will be lost unless polling
    this.logger.debug({ sessionId }, "No active connection for session");
    return {
      ok: false,
      error: "No active connection for session",
    };
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: NormalizedMessage): void {
    const serialized = JSON.stringify({
      type: "message",
      message: this.serializeMessage(message),
    });

    for (const client of this.wsClients.values()) {
      try {
        client.ws.send(serialized);
      } catch {
        // ignore send errors
      }
    }
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  private getSessionFromRequest(req: http.IncomingMessage): string | undefined {
    // Check header
    const headerSession = req.headers["x-session-id"];
    if (typeof headerSession === "string") {
      return headerSession;
    }

    // Check cookie
    const cookies = req.headers.cookie;
    if (cookies) {
      const cookieName = this.config.sessionCookieName ?? "ant_session";
      const match = cookies.match(new RegExp(`${cookieName}=([^;]+)`));
      if (match) {
        return match[1];
      }
    }

    return undefined;
  }

  private updateSession(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastActivity = Date.now();
      existing.messageCount += 1;
    } else {
      this.sessions.set(sessionId, {
        sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 1,
      });
    }
  }

  getSession(sessionId: string): WebSessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  private findWsClientBySession(sessionId: string): WebSocketClient | undefined {
    for (const client of this.wsClients.values()) {
      if (client.sessionId === sessionId) {
        return client;
      }
    }
    return undefined;
  }

  private serializeMessage(message: NormalizedMessage): object {
    return {
      id: message.id,
      content: message.content,
      sender: message.sender,
      timestamp: message.timestamp,
      media: message.media
        ? {
            type: message.media.type,
            mimeType: message.media.mimeType,
            filename: message.media.filename,
            // Don't include raw data - client should fetch separately
          }
        : undefined,
    };
  }

  /**
   * Get the server address
   */
  getAddress(): { host: string; port: number } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (typeof addr === "string" || !addr) return null;
    return { host: addr.address, port: addr.port };
  }
}

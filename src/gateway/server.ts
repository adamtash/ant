/**
 * Gateway Server - WebSocket control plane for the ANT agent
 *
 * Features:
 * - WebSocket server for real-time communication
 * - Session management across channels
 * - Event pub/sub
 * - Request/response handling
 */

import { createServer, type IncomingMessage, type Server } from "node:http";
import fsSync from "node:fs";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import type { Channel } from "../agent/types.js";
import type { Logger } from "../log.js";
import { EventBus } from "./event-bus.js";
import { SessionManager } from "./session-manager.js";
import { loadConfig, saveConfig } from "../config.js";
import type { MessageRouter } from "../channels/router.js";
import type {
  GatewayConnection,
  GatewayEvent,
  GatewayMessage,
  GatewayRequest,
  GatewayResponse,
  GatewayStatus,
} from "./types.js";
import type { AgentEngine } from "../agent/engine.js";

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  port: number;
  host?: string;
  stateDir: string;
  staticDir?: string;
  logFilePath?: string;
  configPath?: string;
}

/**
 * Gateway Server - Main WebSocket control plane
 */
export class GatewayServer {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private connections: Map<string, { ws: WebSocket; connection: GatewayConnection }> = new Map();
  private readonly config: GatewayConfig;
  private readonly logger: Logger;
  private readonly eventBus: EventBus;
  private readonly sessions: SessionManager;
  private readonly agentEngine?: AgentEngine;
  private readonly router?: MessageRouter;
  private startTime: number = 0;
  private tasks: Map<
    string,
    {
      id: string;
      status: "queued" | "running" | "completed" | "failed";
      description: string;
      sessionKey: string;
      chatId: string;
      createdAt: number;
      startedAt?: number;
      endedAt?: number;
      result?: unknown;
      error?: string;
    }
  > = new Map();

  constructor(params: {
    config: GatewayConfig;
    logger: Logger;
    agentEngine?: AgentEngine;
    router?: MessageRouter;
  }) {
    this.config = params.config;
    this.logger = params.logger.child({ component: "gateway" });
    this.eventBus = new EventBus(this.logger);
    this.agentEngine = params.agentEngine;
    this.router = params.router;
    this.sessions = new SessionManager({
      stateDir: params.config.stateDir,
      logger: this.logger,
    });
  }

  /**
   * Set up API routes
   */
  private setupApiRoutes(app: express.Application): void {
    app.use(express.json());

    // Status
    app.get("/api/status", (req, res) => {
      const running = Array.from(this.tasks.values())
        .filter((task) => task.status === "queued" || task.status === "running")
        .map((task) => ({
          sessionKey: task.sessionKey,
          chatId: task.chatId,
          text: task.description,
          status: task.status === "failed" ? "error" : task.status,
          startedAt: task.startedAt ?? task.createdAt,
          endedAt: task.endedAt,
          error: task.error,
        }));
      const status = {
        ok: true,
        time: Date.now(),
        runtime: {
          providers: [],
        },
        queue: [],
        running,
        subagents: [],
        health: {
          cpu: 0,
          memory: process.memoryUsage().heapUsed,
          disk: 0,
          uptime: Date.now() - this.startTime,
          lastRestart: this.startTime,
          queueDepth: 0,
          activeConnections: this.connections.size,
        },
      };
      res.json(status);
    });

    // Sessions list
    app.get("/api/sessions", (req, res) => {
      const list = this.sessions.list().map((s) => ({
        key: s.sessionKey,
        channel: s.channel,
        createdAt: s.createdAt,
        lastMessageAt: s.lastActivityAt,
        messageCount: s.messageCount || 0,
      }));
      res.json({ ok: true, sessions: list });
    });

    // Session detail
    app.get("/api/sessions/:key", async (req, res) => {
      const key = req.params.key;
      // Even if not in memory, try to load messages
      const messages = await this.sessions.readMessages(key);

      if (messages.length === 0 && !this.sessions.get(key)) {
        res.status(404).json({ ok: false, error: "Session not found" });
        return;
      }

      res.json({
        ok: true,
        sessionKey: key,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ts: m.timestamp,
          toolCalls: [],
        })),
      });
    });

    // Config (Basic)
    app.get("/api/config", async (req, res) => {
      try {
        const config = await loadConfig(this.config.configPath);
        res.json({
            ok: true,
            path: this.config.configPath,
            config: config, // Return full config
        });
      } catch (err) {
          res.status(500).json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/config", async (req, res) => {
        try {
            await saveConfig(req.body, this.config.configPath);
            res.json({ ok: true });
        } catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });

    // Channels
    app.get("/api/channels", (req, res) => {
        const channels = [];
        if (this.router) {
            for (const [id, adapter] of this.router.getAdapters()) {
                channels.push({
                    id,
                    status: adapter.getStatus(),
                });
            }
        }
        res.json({ ok: true, channels });
    });

    // Validations for Tasks
    app.post("/api/tasks", async (req, res) => {
      if (!this.agentEngine) {
        res.status(503).json({ ok: false, error: "Agent engine not available" });
        return;
      }

      const { description, prompt, label } = req.body;
      const taskDescription = description || prompt;

      if (!taskDescription) {
        res.status(400).json({ ok: false, error: "Description or prompt is required" });
        return;
      }

      const taskId = `task-${Date.now()}`;
      const sessionKey = `task-${taskId}`; // New session for the task
      const chatId = taskId;

      this.tasks.set(taskId, {
        id: taskId,
        status: "queued",
        description: taskDescription,
        sessionKey,
        chatId,
        createdAt: Date.now(),
        startedAt: Date.now(),
      });

      // Run in background
      (async () => {
        try {
          const task = this.tasks.get(taskId);
          if (!task) return;
          task.status = "running";
          task.startedAt = Date.now();
          this.eventBus.emit({
            id: `evt-${Date.now()}`,
            type: "task_started",
            timestamp: Date.now(),
            sessionKey,
            data: { taskId, description: taskDescription },
          });

          const result = await this.agentEngine!.execute({
            sessionKey,
            query: taskDescription,
            channel: "web",
            chatId,
          });

          const completed = this.tasks.get(taskId);
          if (!completed) return;
          completed.status = "completed";
          completed.result = result;
          completed.endedAt = Date.now();

          this.eventBus.emit({
            id: `evt-${Date.now()}`,
            type: "task_completed",
            timestamp: Date.now(),
            sessionKey,
            data: { taskId, result },
          });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failed = this.tasks.get(taskId);
          if (!failed) return;
          failed.status = "failed";
          failed.error = errorMsg;
          failed.endedAt = Date.now();

          this.eventBus.emit({
            id: `evt-${Date.now()}`,
            type: "error_occurred",
            timestamp: Date.now(),
            sessionKey,
            data: { taskId, error: errorMsg },
          });
        }
      })();

      res.json({
        ok: true,
        id: taskId,
        status: "queued",
        label,
        createdAt: Date.now(),
      });
    });

    // Task status
    app.get("/api/tasks/:id", (req, res) => {
      const task = this.tasks.get(req.params.id);
      if (!task) {
        res.status(404).json({ ok: false, error: "Task not found" });
        return;
      }
      res.json(task);
    });

    // Task list
    app.get("/api/tasks", (req, res) => {
      const list = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
      res.json({ ok: true, tasks: list });
    });

    // Logs Stream (SSE)
    app.get("/api/logs/stream", (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      const logPath = this.config.logFilePath;
      if (!logPath || !fsSync.existsSync(logPath)) {
        res.write(`event: error\ndata: Log file not found at ${logPath}\n\n`);
        return;
      }

      // Send last 50 lines first
      try {
        const content = fsSync.readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(Boolean).slice(-50);
        for (const line of lines) {
          res.write(`event: log\ndata: ${line}\n\n`);
        }
      } catch (err) {
        this.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Failed to read logs");
      }

      // Watch for changes
      let lastSize = fsSync.statSync(logPath).size;
      const watcher = fsSync.watch(logPath, (eventType) => {
        if (eventType === "change") {
          try {
            const stats = fsSync.statSync(logPath);
            if (stats.size > lastSize) {
              const fd = fsSync.openSync(logPath, "r");
              const buffer = Buffer.alloc(stats.size - lastSize);
              fsSync.readSync(fd, buffer, 0, buffer.length, lastSize);
              fsSync.closeSync(fd);

              const newContent = buffer.toString("utf-8");
              const newLines = newContent.split("\n").filter(Boolean);

              for (const line of newLines) {
                res.write(`event: log\ndata: ${line}\n\n`);
              }
              lastSize = stats.size;
            } else {
              lastSize = stats.size;
            }
          } catch (err) {
            // Ignore errors
          }
        }
      });

      // Cleanup on disconnect
      req.on("close", () => {
        watcher.close();
      });
    });

    // Events Stream (SSE)
    app.get("/api/events/stream", (req, res) => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      const unsubscribe = this.eventBus.on("*", (event) => {
        // SSE expects `event:` to be the event name, but here we use generic `event` type
        // and put the actual data in `data`.
        // However, the `client.ts` expects `event instanceof MessageEvent` and parses `data`.
        // The `onEvent` callback in `client.ts` expects `SystemEvent`.
        // `GatewayEvent` should map to `SystemEvent`.
        // Let's ensure the format matches client expectations.
        // Client: `source.addEventListener('event', ...)` so we send `event: event`
        res.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
      });

      // Cleanup on disconnect
      req.on("close", () => {
        unsubscribe();
      });
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

    const app = express();
    this.setupApiRoutes(app);

    // Serve static files if configured
    if (this.config.staticDir) {
      app.use(express.static(this.config.staticDir));
      // fallback for SPA
      app.get("*", (req, res) => {
        if (this.config.staticDir) {
          res.sendFile("index.html", { root: this.config.staticDir });
        } else {
          res.status(404).end();
        }
      });
    }

    this.httpServer = createServer(app);

    this.wss = new WebSocketServer({
      server: this.httpServer,
    });

    this.wss.on("connection", (ws, request) => {
      this.handleConnection(ws, request);
    });

    this.wss.on("error", (error) => {
      this.logger.error({ error: error.message }, "Gateway server error");
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host || "127.0.0.1", () => {
        this.logger.info({ port: this.config.port }, "Gateway server started");
        resolve();
      });
    });
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
        else {
          this.httpServer?.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        }
      });
    });

    this.wss = null;
    this.httpServer = null;
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
      channels: this.router ? 
        Object.fromEntries(
            Array.from(this.router.getAdapters().entries()).map(([k, v]) => [k, v.getStatus()])
        ) :
      {
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

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
import { getEventStream, createEventPublishers } from "../monitor/event-stream.js";
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
import type { MainAgent, MainAgentTask } from "../agent/index.js";
import type { MemoryManager } from "../memory/manager.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { Scheduler as SchedulerUtils } from "../scheduler/scheduler.js";
import { initializeDroneFlights } from "../scheduler/drone-flights-init.js";
import type { SkillRegistryManager } from "../agent/skill-registry.js";
import type { ToolRegistry } from "../agent/tool-registry.js";
import os from "node:os";
import { classifyError, type ClassificationResult, createClassifiedErrorData } from "../monitor/error-classifier.js";
import { ProviderHealthTracker } from "../monitor/provider-health.js";
import type { MonitorEvent, ErrorOccurredData } from "../monitor/types.js";
import { buildAgentScopedSessionKey, buildAgentTaskSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { onAgentEvent, type AgentEventPayload } from "../monitor/agent-events.js";
import { listActiveRuns } from "../agent/active-runs.js";

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
 * System health metrics
 */
export interface SystemHealth {
  cpu: number;
  memory: number;
  disk: number;
  uptime: number;
  lastRestart: number;
  queueDepth: number;
  activeConnections: number;
  totalErrors?: number;
  errorRate?: number;
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
  private mainAgent?: MainAgent;
  private startTime: number = 0;
  private mainAgentRunning: boolean = false;
  private startupHealthCheck: {
    lastCheckAt?: number;
    ok?: boolean;
    error?: string;
    latencyMs?: number;
    responsePreview?: string;
  } = {};
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
  private memoryManager?: MemoryManager;
  private scheduler?: Scheduler;
  private skillRegistry?: SkillRegistryManager;
  private toolRegistry?: ToolRegistry;
  private errorCount = 0;
  private lastErrorTime = 0;
  private eventStream = getEventStream();
  private events = createEventPublishers(this.eventStream);
  private providerHealthTracker: ProviderHealthTracker;
  private agentEventUnsubscribe?: () => void;
  private eventStreamUnsubscribe?: () => void;

  /** Status broadcast state */
  private lastStatus: Record<string, unknown> | null = null;
  private statusDeltaTimer: NodeJS.Timeout | null = null;

  constructor(params: {
    config: GatewayConfig;
    logger: Logger;
    agentEngine?: AgentEngine;
    router?: MessageRouter;
    mainAgent?: MainAgent;
    memoryManager?: MemoryManager;
    scheduler?: Scheduler;
    skillRegistry?: SkillRegistryManager;
    toolRegistry?: ToolRegistry;
  }) {
    this.config = params.config;
    this.logger = params.logger.child({ component: "gateway" });
    this.eventBus = new EventBus(this.logger);
    this.agentEngine = params.agentEngine;
    this.router = params.router;
    this.mainAgent = params.mainAgent;
    this.memoryManager = params.memoryManager;
    this.scheduler = params.scheduler;
    this.skillRegistry = params.skillRegistry;
    this.toolRegistry = params.toolRegistry;
    this.sessions = new SessionManager({
      stateDir: params.config.stateDir,
      logger: this.logger,
    });
    this.providerHealthTracker = new ProviderHealthTracker(this.logger);
    this.providerHealthTracker.connectToStream(this.eventStream);
    this.setupPersistence();
    this.setupErrorTracking();
  }

  private isTestApiEnabled(): boolean {
    return process.env.NODE_ENV === "test" || process.env.ANT_ENABLE_TEST_API === "1";
  }

  /**
   * Set up error tracking for health monitoring
   */
  private setupErrorTracking(): void {
    // Listen to event stream for errors
    getEventStream().subscribeAll((event) => {
      if (event.type === "error_occurred") {
        this.errorCount++;
        this.lastErrorTime = Date.now();
      }
    });
  }

  private mapMonitorEventToSystemEvent(event: MonitorEvent): {
    id: string;
    timestamp: number;
    type: string;
    data: Record<string, unknown>;
    severity: "info" | "warn" | "error" | "critical";
    source: "agent" | "system" | "user";
    sessionKey?: string;
    channel?: string;
  } {
    const base = {
      id: event.id,
      timestamp: event.timestamp || Date.now(),
      data: (event.data || {}) as Record<string, unknown>,
      sessionKey: event.sessionKey ?? undefined,
      channel: event.channel ?? undefined,
    };

    let severity: "info" | "warn" | "error" | "critical" = "info";
    if (event.type === "error_occurred") {
      const errorData = event.data as ErrorOccurredData;
      if (errorData?.severity === "critical") severity = "critical";
      else if (errorData?.severity === "high") severity = "error";
      else if (errorData?.severity === "medium") severity = "warn";
      else severity = "warn";
      if (errorData?.context && typeof errorData.context === "object") {
        const context = errorData.context as Record<string, unknown>;
        if (context.taskId && !base.data.taskId) {
          base.data.taskId = context.taskId;
        }
      }
    } else if (
      event.type === "job_failed" ||
      event.type === "job_completed" ||
      event.type === "job_started" ||
      event.type === "job_enabled" ||
      event.type === "job_disabled" ||
      event.type === "job_created" ||
      event.type === "job_removed"
    ) {
      const jobData = event.data as Record<string, unknown>;
      if (jobData.jobId && !base.data.jobId) {
        base.data.jobId = jobData.jobId;
      }
      if (jobData.name && !base.data.name) {
        base.data.name = jobData.name;
      }
      if (event.type === "job_failed") {
        severity = "error";
      } else {
        severity = "info";
      }
    } else if (event.type === "provider_cooldown") {
      severity = "warn";
    } else if (event.type === "provider_recovery") {
      severity = "info";
    } else if (event.type === "tool_executed") {
      const toolData = event.data as { success?: boolean };
      if (toolData && toolData.success === false) {
        severity = "warn";
      }
    }

    const source: "agent" | "system" | "user" = "system";

    let type = event.type === "subagent_spawned" ? "agent_spawned" : event.type;
    if (event.type === "subagent_spawned") {
      const subagentData = event.data as {
        subagentId?: string;
        task?: string;
        parentTaskId?: string;
      };
      base.data = {
        id: subagentData.subagentId ?? String(base.id),
        label: subagentData.task ?? "subagent",
        taskId: subagentData.parentTaskId,
      };
    }
    if (event.type === "task_started") {
      const taskData = event.data as { taskId?: string; description?: string };
      base.data = {
        id: taskData.taskId ?? String(base.id),
        prompt: taskData.description ?? "Task started",
        description: taskData.description,
      };
    }
    if (event.type === "task_completed") {
      const taskData = event.data as { taskId?: string; result?: unknown; error?: string };
      base.data = {
        id: taskData.taskId ?? String(base.id),
        taskId: taskData.taskId,
        result: taskData.result,
        error: taskData.error,
      };
    }

    return {
      ...base,
      type,
      severity,
      source,
    };
  }

  private mapAgentEventToSystemEvent(event: AgentEventPayload): {
    id: string;
    timestamp: number;
    type: string;
    data: Record<string, unknown>;
    severity: "info" | "warn" | "error" | "critical";
    source: "agent" | "system" | "user";
    sessionKey?: string;
    channel?: string;
  } {
    const severity = event.stream === "error" ? "error" : "info";
    const data = {
      runId: event.runId,
      seq: event.seq,
      stream: event.stream,
      ts: event.ts,
      payload: event.data,
    };
    return {
      id: `agent-${event.runId}-${event.seq}`,
      timestamp: event.ts,
      type: "agent_event",
      data,
      severity,
      source: "agent",
      sessionKey: event.sessionKey,
    };
  }

  /**
   * Set up persistence for messages
   */
  private setupPersistence(): void {
    if (!this.router) return;

    this.router.on("event", async (event) => {
      // Persist incoming messages
      if (event.type === "message_received") {
        const { message } = event;
        // Skip if it's an agent reply (shouldn't happen on message_received but good to check)
        if (message.sender.isAgent) return;

        try {
          await this.sessions.getOrCreate({
            sessionKey: message.context.sessionKey,
            channel: message.channel,
            chatId: message.context.chatId,
          });
          await this.sessions.appendMessage(message.context.sessionKey, {
            role: "user",
            content: message.content,
            timestamp: message.timestamp,
            channel: message.channel,
            chatId: message.context.chatId,
            name: message.sender.name,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.logger.error({ error, sessionKey: message.context.sessionKey }, "Failed to persist user message");
        }
      }

      // Persist outbound agent messages (actual sends, including media and system notices)
      else if (event.type === "message_sent") {
        const { message } = event;
        if (!message.sender.isAgent) return;

        const mediaMeta = message.media
          ? {
              type: message.media.type,
              filename: message.media.filename,
              mimeType: message.media.mimeType,
              path: typeof message.media.data === "string" ? message.media.data : undefined,
              bytes: Buffer.isBuffer(message.media.data) ? message.media.data.length : undefined,
            }
          : undefined;

        const providerId =
          typeof message.metadata?.providerId === "string"
            ? String(message.metadata.providerId)
            : undefined;
        const model =
          typeof message.metadata?.model === "string"
            ? String(message.metadata.model)
            : undefined;

        try {
          await this.sessions.getOrCreate({
            sessionKey: message.context.sessionKey,
            channel: message.channel,
            chatId: message.context.chatId,
          });
          await this.sessions.appendMessage(message.context.sessionKey, {
            role: "assistant",
            content: message.content,
            timestamp: message.timestamp,
            channel: message.channel,
            chatId: message.context.chatId,
            providerId,
            model,
            metadata: {
              ...(typeof message.metadata === "object" && message.metadata ? (message.metadata as Record<string, unknown>) : {}),
              ...(mediaMeta ? { media: mediaMeta } : {}),
              ...(event.error ? { sendError: event.error } : {}),
              sendOk: event.success,
            },
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.logger.error({ error, sessionKey: message.context.sessionKey }, "Failed to persist outbound agent message");
        }
      }
    });

    this.logger.info("Session persistence enabled");
  }

  /**
   * Set up API routes
   */
  private setupApiRoutes(app: express.Application): void {
    app.use(express.json());

    // Status
    app.get("/api/status", async (req, res) => {
      const status = await this.buildStatusResponse();
      res.json(status);
    });

    // Sessions list (paginated)
    app.get("/api/sessions", (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      
      const allSessions = this.sessions.list().map((s) => ({
        key: s.sessionKey,
        channel: s.channel,
        createdAt: s.createdAt,
        lastMessageAt: s.lastActivityAt,
        messageCount: s.messageCount || 0,
      }));
      
      const total = allSessions.length;
      const sessions = allSessions.slice(offset, offset + limit);
      
      res.json({ ok: true, sessions, total, limit, offset });
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
          providerId: m.providerId,
          model: m.model,
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
            const current = await loadConfig(this.config.configPath);
            const merged: Record<string, unknown> = { ...current, ...req.body };
            if ("resolved" in merged) {
              delete (merged as { resolved?: unknown }).resolved;
            }
            await saveConfig(merged, this.config.configPath);
            res.json({ ok: true });
        } catch (err) {
            res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    });

    // ============================================
    // Agents API Endpoints
    // ============================================
    
    // GET /api/agents
    app.get("/api/agents", async (req, res) => {
      // Build agent list from main agent tasks and subagent records
      const agents: Array<{
        id: string;
        caste: "queen" | "worker" | "soldier" | "nurse" | "forager" | "architect" | "drone";
        name: string;
        status: "spawning" | "active" | "thinking" | "idle" | "retired" | "error";
        currentTask?: string;
        progress: number;
        toolsUsed: string[];
        taskCount: number;
        averageDuration: number;
        errorCount: number;
        createdAt: number;
        retiredAt?: number;
        parentAgentId?: string;
        metadata: {
          age: number;
          energy: number;
          specialization: string[];
        };
      }> = [];
      
      // Add main agent as queen
      if (this.mainAgent) {
        const mainTasks = (await this.mainAgent.getAllTasks()) as MainAgentTask[];
        agents.push({
          id: "main-agent",
          caste: "queen",
          name: "Queen",
          status: this.mainAgentRunning ? "active" : "idle",
          currentTask: mainTasks.find((t) => t.status === "running")?.description,
          progress: mainTasks.length > 0 
            ? mainTasks.filter((t) => t.status === "succeeded").length / mainTasks.length 
            : 0,
          toolsUsed: [],
          taskCount: mainTasks.length,
          averageDuration: 0,
          errorCount: mainTasks.filter((t) => t.status === "failed").length,
          createdAt: this.startTime,
          metadata: {
            age: Math.floor((Date.now() - this.startTime) / 1000 / 60), // minutes
            energy: 100,
            specialization: ["management", "supervision"],
          },
        });
      }
      
      // Add running web tasks as worker agents
      for (const task of this.tasks.values()) {
        if (task.status === "running" || task.status === "queued") {
          agents.push({
            id: task.id,
            caste: "worker",
            name: `Worker-${task.id.slice(-4)}`,
            status: task.status === "running" ? "active" : "spawning",
            currentTask: task.description,
            progress: 0,
            toolsUsed: [],
            taskCount: 1,
            averageDuration: task.startedAt ? Date.now() - task.startedAt : 0,
            errorCount: task.error ? 1 : 0,
            createdAt: task.createdAt,
            parentAgentId: "main-agent",
            metadata: {
              age: 0,
              energy: 80,
              specialization: ["execution"],
            },
          });
        }
      }

      // Add subagent tasks as worker agents
      if (this.mainAgent) {
        const mainTasks = (await this.mainAgent.getAllTasks()) as MainAgentTask[];
        for (const task of mainTasks) {
          if (!task.parentTaskId) continue;
          const isActive = ["queued", "running", "retrying"].includes(task.status);
          agents.push({
            id: task.taskId,
            caste: "worker",
            name: `Subagent-${task.taskId.slice(-4)}`,
            status: isActive ? "active" : task.status === "failed" ? "error" : "retired",
            currentTask: task.description,
            progress: task.progress?.total
              ? Math.min(1, task.progress.completed / task.progress.total)
              : 0,
            toolsUsed: task.result?.toolsUsed ?? [],
            taskCount: 1,
            averageDuration: task.updatedAt - task.createdAt,
            errorCount: task.error ? 1 : 0,
            createdAt: task.createdAt,
            parentAgentId: "main-agent",
            metadata: {
              age: Math.floor((Date.now() - task.createdAt) / 1000 / 60),
              energy: isActive ? 70 : 100,
              specialization: [task.phase ?? "execution"],
            },
          });
        }
      }
      
      res.json({ ok: true, agents });
    });

    // GET /api/agents/:id
    app.get("/api/agents/:id", async (req, res) => {
      const { id } = req.params;
      
      // Handle main agent
      if (id === "main-agent" && this.mainAgent) {
        const mainTasks = (await this.mainAgent.getAllTasks()) as MainAgentTask[];
        res.json({
          ok: true,
          agent: {
            id: "main-agent",
            caste: "queen",
            name: "Queen",
            status: this.mainAgentRunning ? "active" : "idle",
            currentTask: mainTasks.find((t) => t.status === "running")?.description,
            progress: mainTasks.length > 0 
              ? mainTasks.filter((t) => t.status === "succeeded").length / mainTasks.length 
              : 0,
            toolsUsed: [],
            taskCount: mainTasks.length,
            averageDuration: 0,
            errorCount: mainTasks.filter((t) => t.status === "failed").length,
            createdAt: this.startTime,
            metadata: {
              age: Math.floor((Date.now() - this.startTime) / 1000 / 60),
              energy: 100,
              specialization: ["management", "supervision"],
            },
          },
        });
        return;
      }
      
      // Handle task agents
      const task = this.tasks.get(id);
      if (task) {
        res.json({
          ok: true,
          agent: {
            id: task.id,
            caste: "worker",
            name: `Worker-${task.id.slice(-4)}`,
            status: task.status === "running" ? "active" : "idle",
            currentTask: task.description,
            progress: 0,
            toolsUsed: [],
            taskCount: 1,
            averageDuration: task.startedAt && task.endedAt 
              ? task.endedAt - task.startedAt 
              : 0,
            errorCount: task.error ? 1 : 0,
            createdAt: task.createdAt,
            parentAgentId: "main-agent",
            metadata: {
              age: Math.floor((Date.now() - task.createdAt) / 1000 / 60),
              energy: task.status === "running" ? 70 : 100,
              specialization: ["execution"],
            },
          },
        });
        return;
      }

      if (this.mainAgent) {
        const mainTasks = (await this.mainAgent.getAllTasks()) as MainAgentTask[];
        const subagent = mainTasks.find((entry) => entry.taskId === id);
        if (subagent) {
          const isActive = ["queued", "running", "retrying"].includes(subagent.status);
          res.json({
            ok: true,
            agent: {
              id: subagent.taskId,
              caste: "worker",
              name: `Subagent-${subagent.taskId.slice(-4)}`,
              status: isActive ? "active" : subagent.status === "failed" ? "error" : "retired",
              currentTask: subagent.description,
              progress: subagent.progress?.total
                ? Math.min(1, subagent.progress.completed / subagent.progress.total)
                : 0,
              toolsUsed: subagent.result?.toolsUsed ?? [],
              taskCount: 1,
              averageDuration: subagent.updatedAt - subagent.createdAt,
              errorCount: subagent.error ? 1 : 0,
              createdAt: subagent.createdAt,
              parentAgentId: "main-agent",
              metadata: {
                age: Math.floor((Date.now() - subagent.createdAt) / 1000 / 60),
                energy: isActive ? 70 : 100,
                specialization: [subagent.phase ?? "execution"],
              },
            },
          });
          return;
        }
      }
      
      res.status(404).json({ ok: false, error: "Agent not found" });
    });

    // ============================================
    // Channels API Endpoints
    // ============================================
    
    // GET /api/channels
    app.get("/api/channels", (req, res) => {
      const channels: Array<{
        id: string;
        status: {
          connected: boolean;
          selfJid?: string;
          qr?: string;
          message?: string;
          connectedAt?: number;
          messageCount?: number;
          lastMessageAt?: number;
          activeUsers?: number;
          responseTime?: number;
          errorRate?: number;
          [key: string]: any;
        };
      }> = [];
      
      if (this.router) {
        for (const [id, adapter] of this.router.getAdapters()) {
          const adapterStatus = adapter.getStatus();
          channels.push({
            id,
            status: {
              connected: adapterStatus.connected ?? false,
              selfJid: adapterStatus.selfJid,
              qr: adapterStatus.qr,
              message: adapterStatus.message,
              connectedAt: adapterStatus.connectedAt,
              messageCount: adapterStatus.messageCount ?? 0,
              lastMessageAt: adapterStatus.lastMessageAt,
              activeUsers: adapterStatus.activeUsers ?? (adapterStatus.connected ? 1 : 0),
              responseTime: adapterStatus.responseTime ?? 0,
              errorRate: adapterStatus.errorRate ?? 0,
            },
          });
        }
      }
      
      // Add web channel if not present
      if (!channels.find(c => c.id === "web")) {
        channels.push({
          id: "web",
          status: {
            connected: this.connections.size > 0,
            activeUsers: this.connections.size,
            responseTime: 0,
            errorRate: 0,
          },
        });
      }
      
      res.json({ ok: true, channels });
    });

    // ============================================
    // Test Harness Endpoints (test mode only)
    // ============================================

    if (this.isTestApiEnabled()) {
      app.post("/api/test/whatsapp/inbound", (req, res) => {
        if (!this.router) {
          res.status(503).json({ ok: false, error: "Router not available" });
          return;
        }

        const adapter = this.router.getAdapter("whatsapp") as any;
        if (!adapter || typeof adapter.injectInbound !== "function") {
          res.status(501).json({ ok: false, error: "WhatsApp test adapter not available" });
          return;
        }

        const chatId = typeof req.body?.chatId === "string" ? req.body.chatId : "";
        const text = typeof req.body?.text === "string" ? req.body.text : "";
        const senderId = typeof req.body?.senderId === "string" ? req.body.senderId : undefined;
        const pushName = typeof req.body?.pushName === "string" ? req.body.pushName : undefined;
        const fromMe = typeof req.body?.fromMe === "boolean" ? req.body.fromMe : undefined;
        const mentions = Array.isArray(req.body?.mentions) ? req.body.mentions : undefined;
        const timestampMs = typeof req.body?.timestampMs === "number" ? req.body.timestampMs : undefined;

        if (!chatId.trim() || !text.trim()) {
          res.status(400).json({ ok: false, error: "chatId and text are required" });
          return;
        }

        const result = adapter.injectInbound({
          chatId,
          text,
          senderId,
          pushName,
          fromMe,
          mentions,
          timestampMs,
        });

        res.json({ ok: true, ...result });
      });

      app.get("/api/test/whatsapp/outbound", (req, res) => {
        if (!this.router) {
          res.status(503).json({ ok: false, error: "Router not available" });
          return;
        }

        const adapter = this.router.getAdapter("whatsapp") as any;
        if (!adapter || typeof adapter.getOutbound !== "function") {
          res.status(501).json({ ok: false, error: "WhatsApp test adapter not available" });
          return;
        }

        const chatId = typeof req.query.chatId === "string" ? req.query.chatId : undefined;
        const sessionKey = typeof req.query.sessionKey === "string" ? req.query.sessionKey : undefined;

        let outbound = adapter.getOutbound();
        if (chatId) outbound = outbound.filter((m: any) => m.chatId === chatId);
        if (sessionKey) outbound = outbound.filter((m: any) => m.sessionKey === sessionKey);

        res.json({ ok: true, outbound });
      });

      app.post("/api/test/whatsapp/outbound/clear", (req, res) => {
        if (!this.router) {
          res.status(503).json({ ok: false, error: "Router not available" });
          return;
        }

        const adapter = this.router.getAdapter("whatsapp") as any;
        if (!adapter || typeof adapter.clearOutbound !== "function") {
          res.status(501).json({ ok: false, error: "WhatsApp test adapter not available" });
          return;
        }

        adapter.clearOutbound();
        res.json({ ok: true });
      });
    }

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
      const sessionKey = buildAgentTaskSessionKey({ agentId: normalizeAgentId("web"), taskId });
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
          await this.events.taskStarted({
            taskId,
            description: taskDescription,
          }, { sessionKey, channel: "web" });
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
          await this.events.taskCompleted({
            taskId,
            result,
          }, { sessionKey, channel: "web" });

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

          await this.events.taskCompleted({
            taskId,
            error: errorMsg,
          }, { sessionKey, channel: "web" });

          await this.events.errorOccurred(
            createClassifiedErrorData(errorMsg, "high", { taskId, sessionKey, channel: "web" }),
            { sessionKey, channel: "web" }
          );

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

    // Task list (paginated)
    app.get("/api/tasks", (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      
      const allTasks = Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
      const total = allTasks.length;
      const tasks = allTasks.slice(offset, offset + limit);
      
      res.json({ ok: true, tasks, total, limit, offset });
    });

    // Logs (paginated)
    app.get("/api/logs", (req, res) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      
      const logPath = this.config.logFilePath;
      if (!logPath || !fsSync.existsSync(logPath)) {
        res.json({ ok: true, data: [], total: 0, limit, offset });
        return;
      }
      
      try {
        const content = fsSync.readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(Boolean).reverse(); // Most recent first
        
        const total = lines.length;
        const data = lines.slice(offset, offset + limit);
        
        res.json({ ok: true, data, total, limit, offset });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
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

      const shouldSkipLogLine = (line: string): boolean => {
        try {
          const entry = JSON.parse(line) as { level?: number; msg?: string; component?: string; module?: string };
          if ((entry.component === "adapter" && entry.module === "whatsapp-client") && (entry.level ?? 0) <= 20) {
            return true;
          }
        } catch {
          // Ignore parse errors
        }
        return false;
      };

      // Send last 50 lines first
      try {
        const content = fsSync.readFileSync(logPath, "utf-8");
        const lines = content.split("\n").filter(Boolean).slice(-50);
        for (const line of lines) {
          if (!shouldSkipLogLine(line)) {
            res.write(`event: log\ndata: ${line}\n\n`);
          }
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
                  if (!shouldSkipLogLine(line)) {
                    res.write(`event: log\ndata: ${line}\n\n`);
                  }
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
      res.write(": ok\n\n");

      // Subscribe to global event stream
      const unsubscribe = getEventStream().subscribeAll((event) => {
        const normalized = this.mapMonitorEventToSystemEvent(event as MonitorEvent);
        res.write(`event: event\ndata: ${JSON.stringify(normalized)}\n\n`);
      });
      const unsubscribeAgent = onAgentEvent((event) => {
        const normalized = this.mapAgentEventToSystemEvent(event);
        res.write(`event: event\ndata: ${JSON.stringify(normalized)}\n\n`);
      });

      // Cleanup on disconnect
      req.on("close", () => {
        unsubscribe();
        unsubscribeAgent();
      });
    });

    // ============================================
    // Health Endpoint
    // ============================================
    app.get("/api/health", (req, res) => {
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      // Calculate CPU usage (simplified)
      const cpuUsage = os.loadavg()[0] || 0;
      const cpuCount = os.cpus().length || 1;
      const cpuPercent = Math.min(100, Math.round((cpuUsage / cpuCount) * 100));
      
      // Calculate memory percentage
      const memPercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
      
      // Error rate (errors per minute)
      const now = Date.now();
      const timeSinceLastError = now - this.lastErrorTime;
      const errorRate = timeSinceLastError < 60000 ? this.errorCount : 0;
      
      const health: SystemHealth = {
        cpu: cpuPercent,
        memory: memPercent,
        disk: 0, // Would need additional library to calculate
        uptime: Date.now() - this.startTime,
        lastRestart: this.startTime,
        queueDepth: this.router?.getSessionQueueStats().queued ?? 0,
        activeConnections: this.connections.size,
        totalErrors: this.errorCount,
        errorRate: errorRate,
      };
      
      res.json({ ok: true, health });
    });

    // ============================================
    // Error Classification Endpoint
    // ============================================
    
    // POST /api/errors/classify
    app.post("/api/errors/classify", (req, res) => {
      const { error, context } = req.body;
      
      if (!error) {
        res.status(400).json({ ok: false, error: "Error message is required" });
        return;
      }
      
      try {
        const classification = classifyError(error, context);
        res.json({ ok: true, classification });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/errors/stats
    app.get("/api/errors/stats", (req, res) => {
      // Return error statistics from health tracking
      res.json({
        ok: true,
        stats: {
          totalErrors: this.errorCount,
          lastErrorAt: this.lastErrorTime,
          errorRate: Date.now() - this.lastErrorTime < 60000 ? this.errorCount : 0,
        },
      });
    });

    // ============================================
    // Provider Health API Endpoints
    // ============================================
    
    // GET /api/providers/health
    app.get("/api/providers/health", (req, res) => {
      try {
        const providers = this.providerHealthTracker.getAllProviderHealth();
        const summary = this.providerHealthTracker.getSummary();
        
        res.json({
          ok: true,
          providers,
          summary,
        });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/providers/health/:id
    app.get("/api/providers/health/:id", (req, res) => {
      try {
        const provider = this.providerHealthTracker.getProviderHealth(req.params.id);
        if (!provider) {
          res.status(404).json({ ok: false, error: "Provider not found" });
          return;
        }
        
        res.json({
          ok: true,
          provider,
        });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // ============================================
    // Memory API Endpoints
    // ============================================
    
    // GET /api/memory/stats
    app.get("/api/memory/stats", async (req, res) => {
      if (!this.memoryManager) {
        res.json({ 
          ok: true, 
          stats: { 
            enabled: false, 
            fileCount: 0, 
            lastRunAt: 0,
            categories: {},
            totalSize: 0,
          } 
        });
        return;
      }
      
      try {
        // Get stats from skill registry or estimate from memory system
        const stats = {
          enabled: true,
          fileCount: 0, // Would need to get from SQLite store
          lastRunAt: Date.now(),
          categories: {} as Record<string, number>,
          totalSize: 0,
        };
        
        res.json({ ok: true, stats });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/memory/search?q=<query>
    app.get("/api/memory/search", async (req, res) => {
      const query = req.query.q as string;
      
      if (!query) {
        res.status(400).json({ ok: false, error: "Query parameter 'q' is required" });
        return;
      }
      
      if (!this.memoryManager) {
        res.json({ ok: true, results: [], query });
        return;
      }
      
      try {
        const results = await this.memoryManager.search(query);
        
        // Transform results to match UI expected format
        const memories = results.map((r, i) => ({
          id: r.chunkId || `${r.path}#${r.startLine}`,
          content: r.snippet,
          type: r.source === "sessions" ? "session" : "indexed" as const,
          category: r.source,
          tags: [],
          searchScore: r.score,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          accessCount: 0,
          references: [],
        }));
        
        res.json({ ok: true, results: memories, query });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/memory/index
    app.get("/api/memory/index", async (req, res) => {
      if (!this.memoryManager) {
        res.json({ ok: true, memories: [], total: 0 });
        return;
      }
      
      try {
        // Return empty for now - full index listing would need store support
        res.json({ ok: true, memories: [], total: 0 });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // POST /api/memory
    app.post("/api/memory", async (req, res) => {
      const { content, category, tags } = req.body;
      
      if (!content) {
        res.status(400).json({ ok: false, error: "Content is required" });
        return;
      }
      
      if (!this.memoryManager) {
        res.status(503).json({ ok: false, error: "Memory manager not available" });
        return;
      }
      
      try {
        await this.memoryManager.update(content);
        
        res.json({ 
          ok: true, 
          id: `mem-${Date.now()}`, 
          timestamp: Date.now() 
        });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // ============================================
    // Jobs API Endpoints
    // ============================================
    
    // GET /api/jobs (paginated)
    app.get("/api/jobs", (req, res) => {
      if (!this.scheduler) {
        res.json({ ok: true, jobs: [], data: [], total: 0, limit: 20, offset: 0 });
        return;
      }
      
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      
      try {
        const jobs = this.scheduler.listJobs();
        
        // Transform to UI expected format
        const allJobs = jobs.map((job) => ({
          id: job.id,
          name: job.name,
          schedule: job.schedule,
          naturalLanguage: job.schedule, // Could be improved with natural language parsing
          enabled: job.enabled,
          lastRunAt: job.lastRun,
          nextRunAt: SchedulerUtils.getNextRunTime(job.schedule)?.getTime() ?? Date.now(),
          trigger: {
            type: job.trigger.type as "agent_ask" | "tool_call" | "webhook",
            data: job.trigger.type === "agent_ask" 
              ? { prompt: (job.trigger as any).prompt || "" }
              : job.trigger.type === "tool_call"
              ? { tool: (job.trigger as any).tool, args: (job.trigger as any).args }
              : { url: (job.trigger as any).url },
          },
          actions: (job.actions || []).map((a) => ({
            type: a.type as "memory_update" | "send_message" | "log_event",
            data: a,
          })),
          executionHistory: job.lastResult 
            ? [{
                runAt: job.lastRun || Date.now(),
                duration: job.lastResult.duration || 0,
                status: job.lastResult.status === "success" ? "success" as const : "error" as const,
              }]
            : [],
        }));
        
        const total = allJobs.length;
        const data = allJobs.slice(offset, offset + limit);
        
        res.json({ ok: true, jobs: data, data, total, limit, offset });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/jobs/:id
    app.get("/api/jobs/:id", (req, res) => {
      if (!this.scheduler) {
        res.status(503).json({ ok: false, error: "Scheduler not available" });
        return;
      }
      
      const job = this.scheduler.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, error: "Job not found" });
        return;
      }
      
      res.json({ ok: true, job });
    });

    // POST /api/jobs/:id/toggle
    app.post("/api/jobs/:id/toggle", async (req, res) => {
      if (!this.scheduler) {
        res.status(503).json({ ok: false, error: "Scheduler not available" });
        return;
      }
      
      const job = this.scheduler.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, error: "Job not found" });
        return;
      }
      
      try {
        if (job.enabled) {
          await this.scheduler.disableJob(req.params.id);
          await this.events.jobDisabled({ jobId: job.id, name: job.name });
        } else {
          await this.scheduler.enableJob(req.params.id);
          await this.events.jobEnabled({ jobId: job.id, name: job.name });
        }
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // POST /api/jobs/:id/run
    app.post("/api/jobs/:id/run", async (req, res) => {
      if (!this.scheduler) {
        res.status(503).json({ ok: false, error: "Scheduler not available" });
        return;
      }
      
      const job = this.scheduler.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, error: "Job not found" });
        return;
      }
      
      try {
        await this.events.jobStarted({
          jobId: job.id,
          name: job.name,
          schedule: job.schedule,
          triggeredAt: Date.now(),
        });
        
        const result = await this.scheduler.runJob(req.params.id);
        
        if (result.status === "success") {
          await this.events.jobCompleted({
            jobId: job.id,
            name: job.name,
            duration: result.duration,
            retryCount: result.retryCount || 0,
          });
        } else {
          await this.events.jobFailed({
            jobId: job.id,
            name: job.name,
            duration: result.duration,
            error: result.error || "Unknown error",
            retryCount: result.retryCount || 0,
          });
        }
        
        res.json({ 
          ok: result.status === "success" || result.status === "failure", 
          executedAt: result.completedAt,
          jobRunId: `run-${Date.now()}`,
          error: result.error,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.events.jobFailed({
          jobId: req.params.id,
          name: job?.name || "Unknown",
          duration: 0,
          error: errorMsg,
          retryCount: 0,
        });
        res.status(500).json({ 
          ok: false, 
          error: errorMsg 
        });
      }
    });

    // POST /api/jobs
    app.post("/api/jobs", async (req, res) => {
      if (!this.scheduler) {
        res.status(503).json({ ok: false, error: "Scheduler not available" });
        return;
      }
      
      const { name, schedule, trigger, actions } = req.body;
      
      if (!name || !schedule) {
        res.status(400).json({ ok: false, error: "Name and schedule are required" });
        return;
      }
      
      try {
        const job = await this.scheduler.addJob({
          id: `job-${Date.now()}`,
          name,
          schedule,
          trigger: trigger || { type: "agent_ask", prompt: "" },
          actions: actions || [],
          enabled: true,
        });
        
        await this.events.jobCreated({
          jobId: job.id,
          name: job.name,
          schedule: job.schedule,
          triggerType: job.trigger.type,
        });
        
        res.json({ ok: true, id: job.id });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // DELETE /api/jobs/:id
    app.delete("/api/jobs/:id", async (req, res) => {
      if (!this.scheduler) {
        res.status(503).json({ ok: false, error: "Scheduler not available" });
        return;
      }
      
      const job = this.scheduler.getJob(req.params.id);
      if (!job) {
        res.status(404).json({ ok: false, error: "Job not found" });
        return;
      }
      
      try {
        const removed = await this.scheduler.removeJob(req.params.id);
        if (!removed) {
          res.status(404).json({ ok: false, error: "Job not found" });
          return;
        }
        
        await this.events.jobRemoved({
          jobId: job.id,
          name: job.name,
        });
        
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // ============================================
    // Skills API Endpoints
    // ============================================
    
    // GET /api/skills
    app.get("/api/skills", async (req, res) => {
      try {
        let skills: any[] = [];
        
        // Get skills from skill registry if available
        if (this.skillRegistry) {
          const registeredSkills = await this.skillRegistry.getAllSkills();
          skills = registeredSkills.map((s) => ({
            name: s.name,
            description: s.purpose,
            category: "custom",
            version: "1.0.0",
            author: s.author,
            createdAt: new Date(s.createdAt).getTime(),
            updatedAt: Date.now(),
            usageCount: 0,
            parameters: {},
            source: s.usage,
          }));
        }
        
        // Also get built-in tools from tool registry
        if (this.toolRegistry) {
          const tools = this.toolRegistry.getAll();
          const toolSkills = tools.map((t: { meta: { name: string; description: string; category: string; version: string; author?: string }; parameters: unknown }) => ({
            name: t.meta.name,
            description: t.meta.description,
            category: t.meta.category,
            version: t.meta.version,
            author: t.meta.author || "system",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            usageCount: 0,
            parameters: t.parameters,
          }));
          skills = [...skills, ...toolSkills];
        }
        
        // Get unique categories
        const categories = [...new Set(skills.map((s) => s.category))];
        
        res.json({ ok: true, skills, categories });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/skills/:name
    app.get("/api/skills/:name", async (req, res) => {
      const name = decodeURIComponent(req.params.name);
      
      try {
        // Check skill registry first
        if (this.skillRegistry) {
          const skill = await this.skillRegistry.getSkill(name);
          if (skill) {
            res.json({
              ok: true,
              skill: {
                name: skill.name,
                description: skill.purpose,
                category: "custom",
                version: "1.0.0",
                author: skill.author,
                createdAt: new Date(skill.createdAt).getTime(),
                updatedAt: Date.now(),
                usageCount: 0,
                parameters: {},
              },
              source: skill.usage,
            });
            return;
          }
        }
        
        // Check tool registry
        if (this.toolRegistry) {
          const tool = this.toolRegistry.get(name);
          if (tool) {
            res.json({
              ok: true,
              skill: {
                name: tool.meta.name,
                description: tool.meta.description,
                category: tool.meta.category,
                version: tool.meta.version,
                author: tool.meta.author || "system",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                usageCount: 0,
                parameters: tool.parameters,
              },
              source: "built-in",
            });
            return;
          }
        }
        
        res.status(404).json({ ok: false, error: "Skill not found" });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // POST /api/skills
    app.post("/api/skills", async (req, res) => {
      const { name, description, source, category } = req.body;
      
      if (!name || !description) {
        res.status(400).json({ ok: false, error: "Name and description are required" });
        return;
      }
      
      if (!this.skillRegistry) {
        res.status(503).json({ ok: false, error: "Skill registry not available" });
        return;
      }
      
      try {
        await this.skillRegistry.addSkill({
          name,
          purpose: description,
          usage: source || `tool_${name}`,
          createdAt: new Date().toISOString(),
          author: "user",
          parameters: "",
          status: "active",
        });
        
        await this.events.skillCreated({
          name,
          description,
          author: "user",
        });
        
        res.json({ ok: true, id: name });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // DELETE /api/skills/:name
    app.delete("/api/skills/:name", async (req, res) => {
      const name = decodeURIComponent(req.params.name);
      
      if (!this.skillRegistry) {
        res.status(503).json({ ok: false, error: "Skill registry not available" });
        return;
      }
      
      try {
        const removed = await this.skillRegistry.removeSkill(name);
        if (!removed) {
          res.status(404).json({ ok: false, error: "Skill not found" });
          return;
        }
        
        await this.events.skillDeleted({ name });
        
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // GET /api/tools (built-in tools; read-only)
    app.get("/api/tools", (req, res) => {
      if (!this.toolRegistry) {
        res.json({ ok: true, tools: [] });
        return;
      }
      
      try {
        const tools = this.toolRegistry.getAll().map((t: { meta: { name: string; description: string; category: string; version: string; author?: string }; parameters: unknown }) => ({
          name: t.meta.name,
          description: t.meta.description,
          category: t.meta.category,
          version: t.meta.version,
          author: t.meta.author || "system",
          parameters: t.parameters,
        }));
        
        res.json({ ok: true, tools });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
    });

    // ============================================
    // Main Agent Routes
    // ============================================
    
    // List Main Agent tasks
    app.get("/api/main-agent/tasks", async (req, res) => {
      if (!this.mainAgent) {
        res.status(503).json({ ok: false, error: "Main Agent not available" });
        return;
      }
      const tasks = await this.mainAgent.getAllTasks();
      res.json({ ok: true, tasks });
    });

    // Get specific Main Agent task
    app.get("/api/main-agent/tasks/:id", async (req, res) => {
      if (!this.mainAgent) {
        res.status(503).json({ ok: false, error: "Main Agent not available" });
        return;
      }
      const task = await this.mainAgent.getTask(req.params.id);
      if (!task) {
        res.status(404).json({ ok: false, error: "Task not found" });
        return;
      }
      res.json({ ok: true, task });
    });

    // Assign new task to Main Agent
    app.post("/api/main-agent/tasks", async (req, res) => {
      if (!this.mainAgent) {
        res.status(503).json({ ok: false, error: "Main Agent not available" });
        return;
      }

      const { description } = req.body;
      if (!description) {
        res.status(400).json({ ok: false, error: "Description is required" });
        return;
      }

      try {
        const taskId = await this.mainAgent.assignTask(description);
        res.json({ ok: true, taskId, status: "pending" });
      } catch (err) {
        res.status(500).json({ 
          ok: false, 
          error: err instanceof Error ? err.message : String(err) 
        });
      }
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

    if (this.scheduler) {
      const droneFlightCount = await initializeDroneFlights(this.scheduler, this.logger, { emitEvents: true });
      this.logger.info({ count: droneFlightCount }, "Drone Flights initialized");
    }

    // Load all existing sessions from disk
    await this.sessions.initialize();

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
      this.events.errorOccurred(
        createClassifiedErrorData(error, "high", { component: "gateway", area: "wss" }),
        { channel: "web" }
      ).catch(() => {});
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host || "127.0.0.1", () => {
        this.logger.info({ port: this.config.port }, "Gateway server started");
        resolve();
      });
    });
    // Wire up global event stream to gateway broadcast
    this.eventStreamUnsubscribe = getEventStream().subscribeAll((event) => {
      const normalized = this.mapMonitorEventToSystemEvent(event as MonitorEvent);
      this.broadcast(normalized);
      this.scheduleStatusDelta();
    });
    this.agentEventUnsubscribe = onAgentEvent((event) => {
      const normalized = this.mapAgentEventToSystemEvent(event);
      this.broadcast(normalized);
      this.scheduleStatusDelta();
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
    if (this.agentEventUnsubscribe) {
      this.agentEventUnsubscribe();
      this.agentEventUnsubscribe = undefined;
    }
    if (this.eventStreamUnsubscribe) {
      this.eventStreamUnsubscribe();
      this.eventStreamUnsubscribe = undefined;
    }
    this.logger.info("Gateway server stopped");
  }

  /**
   * Mark main agent running state (for status surfaces)
   */
  setMainAgentRunning(running: boolean): void {
    this.mainAgentRunning = running;
  }

  /**
   * Set the Main Agent instance
   */
  setMainAgent(mainAgent: MainAgent): void {
    this.mainAgent = mainAgent;
  }

  /**
   * Run a lightweight startup health check through the agent engine
   */
  async runStartupHealthCheck(options?: { prompt?: string; timeoutMs?: number; delayMs?: number }): Promise<void> {
    if (!this.agentEngine) {
      this.startupHealthCheck = {
        lastCheckAt: Date.now(),
        ok: false,
        error: "Agent engine not available",
      };
      return;
    }

    const prompt = options?.prompt ?? "Health check: respond with OK.";
    const timeoutMs = options?.timeoutMs ?? 300000;
    const delayMs = options?.delayMs ?? 3000;
    const startedAt = Date.now();

    this.startupHealthCheck = {
      lastCheckAt: startedAt,
      ok: false,
    };

    try {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const timeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Health check timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const sessionKey = buildAgentScopedSessionKey({
        agentId: normalizeAgentId("main"),
        scope: "healthcheck:startup",
      });
      const result = await Promise.race([
        this.agentEngine.execute({
          sessionKey,
          query: prompt,
          channel: "web",
          chatId: sessionKey,
        }),
        timeout,
      ]);

      let responsePreview: string | undefined;
      try {
        if (typeof result === "string") {
          responsePreview = result;
        } else {
          responsePreview = JSON.stringify(result);
        }
      } catch {
        responsePreview = String(result);
      }

      this.startupHealthCheck = {
        lastCheckAt: startedAt,
        ok: true,
        latencyMs: Date.now() - startedAt,
        responsePreview: responsePreview?.slice(0, 200),
      };

      this.logger.info({ latencyMs: this.startupHealthCheck.latencyMs }, "Startup health check succeeded");
    } catch (err) {
      this.startupHealthCheck = {
        lastCheckAt: startedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      this.logger.warn({ error: this.startupHealthCheck.error }, "Startup health check failed");
    }
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

    this.scheduleStatusDelta();

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

      this.scheduleStatusDelta();

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
      this.events.errorOccurred(
        createClassifiedErrorData(error, "medium", { component: "gateway", area: "ws", connectionId }),
        { sessionKey, channel }
      ).catch(() => {});
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

    // Send initial status snapshot
    this.sendStatusSnapshot(ws).catch(() => {});
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
            data: await this.getStatus(),
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
  broadcast(event: GatewayEvent | Record<string, unknown>): void {
    const message: GatewayMessage = {
      id: this.generateId(),
      type: "event",
      payload: event,
      timestamp: Date.now(),
    };

    for (const { ws, connection } of this.connections.values()) {
      // Only send to relevant sessions
      const sessionKey = "sessionKey" in event ? (event.sessionKey as string | undefined) : undefined;
      if (sessionKey && connection.sessionKey !== sessionKey) {
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
   * Schedule a debounced status delta broadcast
   */
  private scheduleStatusDelta(): void {
    if (this.statusDeltaTimer) return;
    const debounceMs = 200;
    this.statusDeltaTimer = setTimeout(() => {
      this.statusDeltaTimer = null;
      void this.broadcastStatusDelta();
    }, debounceMs);
  }

  /**
   * Send full status snapshot to a single connection
   */
  private async sendStatusSnapshot(ws: WebSocket): Promise<void> {
    const status = await this.buildStatusResponse();
    this.send(ws, {
      id: this.generateId(),
      type: "event",
      payload: {
        type: "status_snapshot",
        data: { data: status },
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast status deltas to all connections
   */
  private async broadcastStatusDelta(): Promise<void> {
    const status = await this.buildStatusResponse();
    if (!this.lastStatus) {
      this.lastStatus = status;
      for (const { ws } of this.connections.values()) {
        if (ws.readyState === WebSocket.OPEN) {
          await this.sendStatusSnapshot(ws);
        }
      }
      return;
    }

    const changes = this.diffStatus(this.lastStatus, status);
    if (Object.keys(changes).length === 0) return;
    this.lastStatus = status;

    for (const { ws } of this.connections.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        this.send(ws, {
          id: this.generateId(),
          type: "event",
          payload: {
            type: "status_delta",
            data: { changes },
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Get gateway status
   */
  async getStatus(): Promise<GatewayStatus> {
    return {
      connected: this.wss !== null,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      connections: this.connections.size,
      activeSessions: this.sessions.activeCount,
      queueDepth: this.router?.getSessionQueueStats().queued ?? 0,
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

  private async buildStatusResponse(): Promise<Record<string, unknown>> {
    const mainAgentTasks = (this.mainAgent ? await this.mainAgent.getAllTasks() : []) as MainAgentTask[];
    const subagents = mainAgentTasks
      .filter((task) => task.parentTaskId)
      .map((task) => {
        const startedAt =
          task.history.find((entry: { state: string; at: number }) => entry.state === "running")?.at ??
          task.createdAt;
        const endedAt = ["succeeded", "failed", "canceled"].includes(task.status)
          ? task.history.find((entry: { state: string; at: number }) => entry.state === task.status)?.at ??
            task.updatedAt
          : undefined;

        return {
          id: task.taskId,
          task: task.description,
          label: task.phase ?? "subagent",
          status: task.status,
          createdAt: task.createdAt,
          startedAt,
          endedAt,
        };
      });
    const activeRuns = listActiveRuns().map((run) => ({
      runId: run.runId,
      sessionKey: run.sessionKey,
      agentType: run.agentType,
      startedAt: run.startedAt,
      metadata: run.metadata,
    }));
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

    return {
      ok: true,
      time: Date.now(),
      runtime: {
        providers: [],
      },
      queue: [],
      running,
      activeRuns,
      subagents,
      mainAgent: {
        enabled: this.mainAgent?.config?.mainAgent?.enabled ?? false,
        running: this.mainAgentRunning,
        tasks: mainAgentTasks.map((task) => ({
          id: task.taskId,
          description: task.description,
          status: task.status,
          createdAt: task.createdAt,
          completedAt: task.status === "succeeded" || task.status === "failed" ? task.updatedAt : undefined,
          result: task.result?.content,
        })),
        lastCheckAt: this.startupHealthCheck.lastCheckAt ?? null,
        lastError: this.startupHealthCheck.ok ? null : this.startupHealthCheck.error ?? null,
      },
      startupHealthCheck: {
        lastCheckAt: this.startupHealthCheck.lastCheckAt ?? null,
        ok: this.startupHealthCheck.ok ?? null,
        error: this.startupHealthCheck.error ?? null,
        latencyMs: this.startupHealthCheck.latencyMs ?? null,
        responsePreview: this.startupHealthCheck.responsePreview ?? null,
      },
      health: {
        cpu: 0,
        memory: process.memoryUsage().heapUsed,
        disk: 0,
        uptime: Date.now() - this.startTime,
        lastRestart: this.startTime,
        queueDepth: this.router?.getSessionQueueStats().queued ?? 0,
        activeConnections: this.connections.size,
      },
    };
  }

  private diffStatus(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(next) as Array<keyof GatewayStatus>) {
      const prevValue = prev[key];
      const nextValue = next[key];
      if (JSON.stringify(prevValue) !== JSON.stringify(nextValue)) {
        changes[key] = nextValue;
      }
    }
    return changes;
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

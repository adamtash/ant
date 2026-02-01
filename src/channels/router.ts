/**
 * Message Router
 *
 * Central routing layer for multi-channel message handling.
 * Features:
 * - Routes incoming messages to appropriate handlers
 * - Maintains session context across channels
 * - Handles message queuing with priority
 * - Supports middleware pipeline
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type {
  Channel,
  NormalizedMessage,
  MessageHandler,
  RouteConfig,
  QueuedMessage,
  ChannelSession,
  MessagePriority,
} from "./types.js";
import type { BaseChannelAdapter } from "./base-adapter.js";
import type { Logger } from "../log.js";

// ============================================================================
// Configuration
// ============================================================================

export interface RouterConfig {
  /** Logger instance */
  logger: Logger;

  /** Maximum queue size per channel */
  maxQueueSize?: number;

  /** Queue processing concurrency */
  concurrency?: number;

  /** Default handler for unrouted messages */
  defaultHandler?: MessageHandler;

  /** Session timeout in ms */
  sessionTimeoutMs?: number;
}

// ============================================================================
// Middleware Types
// ============================================================================

export type MiddlewareFunction = (
  message: NormalizedMessage,
  next: () => Promise<NormalizedMessage | null>
) => Promise<NormalizedMessage | null>;

// ============================================================================
// Router Events
// ============================================================================

export type RouterEvent =
  | { type: "message_received"; message: NormalizedMessage }
  | { type: "message_processed"; message: NormalizedMessage; response?: NormalizedMessage }
  | { type: "message_queued"; message: NormalizedMessage; queueSize: number }
  | { type: "message_dropped"; message: NormalizedMessage; reason: string }
  | { type: "error"; error: Error; message?: NormalizedMessage }
  | { type: "adapter_connected"; channel: Channel }
  | { type: "adapter_disconnected"; channel: Channel; reason?: string };

// ============================================================================
// Message Router
// ============================================================================

export class MessageRouter extends EventEmitter {
  private readonly logger: Logger;
  private readonly maxQueueSize: number;
  private readonly concurrency: number;
  private readonly sessionTimeoutMs: number;

  /** Registered channel adapters */
  private readonly adapters: Map<Channel, BaseChannelAdapter> = new Map();

  /** Message routes */
  private readonly routes: RouteConfig[] = [];

  /** Default handler */
  private defaultHandler: MessageHandler | undefined;

  /** Middleware stack */
  private readonly middleware: MiddlewareFunction[] = [];

  /** Message queues per channel */
  private readonly queues: Map<Channel, QueuedMessage[]> = new Map();

  /** Active processing count per channel */
  private readonly processing: Map<Channel, number> = new Map();

  /** Cross-channel sessions */
  private readonly sessions: Map<string, ChannelSession> = new Map();

  /** Cleanup interval */
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RouterConfig) {
    super();
    this.logger = config.logger.child({ component: "router" });
    this.maxQueueSize = config.maxQueueSize ?? 1000;
    this.concurrency = config.concurrency ?? 1;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000;
    this.defaultHandler = config.defaultHandler;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the router
   */
  start(): void {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.pruneExpiredSessions();
    }, 60_000);

    this.logger.info("Message router started");
  }

  /**
   * Stop the router
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Wait for queues to drain
    await this.drainQueues();

    this.logger.info("Message router stopped");
  }

  // ==========================================================================
  // Adapter Management
  // ==========================================================================

  /**
   * Register a channel adapter
   */
  registerAdapter(adapter: BaseChannelAdapter): void {
    const channel = adapter.channel;

    if (this.adapters.has(channel)) {
      throw new Error(`Adapter for channel "${channel}" already registered`);
    }

    this.adapters.set(channel, adapter);
    this.queues.set(channel, []);
    this.processing.set(channel, 0);

    // Subscribe to adapter events
    adapter.onEvent((event) => {
      switch (event.type) {
        case "message":
          this.handleIncomingMessage(event.message);
          break;
        case "connected":
          this.emit("event", { type: "adapter_connected", channel });
          break;
        case "disconnected":
          this.emit("event", { type: "adapter_disconnected", channel, reason: event.reason });
          break;
        case "error":
          this.logger.warn({ channel, error: event.error.message }, "Adapter error");
          break;
      }
    });

    this.logger.info({ channel }, "Adapter registered");
  }

  /**
   * Unregister a channel adapter
   */
  unregisterAdapter(channel: Channel): void {
    const adapter = this.adapters.get(channel);
    if (adapter) {
      this.adapters.delete(channel);
      this.queues.delete(channel);
      this.processing.delete(channel);
      this.logger.info({ channel }, "Adapter unregistered");
    }
  }

  /**
   * Get a registered adapter
   */
  getAdapter<T extends BaseChannelAdapter>(channel: Channel): T | undefined {
    return this.adapters.get(channel) as T | undefined;
  }

  /**
   * Get all registered adapters
   */
  getAdapters(): Map<Channel, BaseChannelAdapter> {
    return new Map(this.adapters);
  }

  // ==========================================================================
  // Routing
  // ==========================================================================

  /**
   * Add a route
   */
  addRoute(config: RouteConfig): void {
    this.routes.push(config);
    // Sort by priority (higher first)
    this.routes.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Remove routes matching a pattern
   */
  removeRoutes(filter: (config: RouteConfig) => boolean): number {
    const before = this.routes.length;
    const remaining = this.routes.filter((r) => !filter(r));
    this.routes.length = 0;
    this.routes.push(...remaining);
    return before - this.routes.length;
  }

  /**
   * Set the default handler
   */
  setDefaultHandler(handler: MessageHandler): void {
    this.defaultHandler = handler;
  }

  /**
   * Add middleware
   */
  use(middleware: MiddlewareFunction): void {
    this.middleware.push(middleware);
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  /**
   * Handle an incoming message
   */
  private handleIncomingMessage(message: NormalizedMessage): void {
    this.emit("event", { type: "message_received", message });

    // Update session
    this.updateSession(message);

    // Add to queue
    const queue = this.queues.get(message.channel);
    if (!queue) {
      this.logger.warn({ channel: message.channel }, "No queue for channel");
      return;
    }

    // Check queue size
    if (queue.length >= this.maxQueueSize) {
      this.emit("event", {
        type: "message_dropped",
        message,
        reason: "queue_full",
      });
      this.logger.warn({ channel: message.channel }, "Queue full, dropping message");
      return;
    }

    // Add to queue with priority ordering
    const queuedMessage: QueuedMessage = {
      message,
      enqueuedAt: Date.now(),
      attempts: 0,
    };

    this.insertByPriority(queue, queuedMessage);
    this.emit("event", { type: "message_queued", message, queueSize: queue.length });

    // Process queue
    this.processQueue(message.channel);
  }

  /**
   * Insert a message into the queue by priority
   */
  private insertByPriority(queue: QueuedMessage[], item: QueuedMessage): void {
    const priority = this.getPriorityValue(item.message.priority);

    // Find insertion point
    let insertIndex = queue.length;
    for (let i = 0; i < queue.length; i++) {
      const existingPriority = this.getPriorityValue(queue[i]!.message.priority);
      if (priority > existingPriority) {
        insertIndex = i;
        break;
      }
    }

    queue.splice(insertIndex, 0, item);
  }

  private getPriorityValue(priority: MessagePriority): number {
    switch (priority) {
      case "high":
        return 2;
      case "normal":
        return 1;
      case "low":
        return 0;
    }
  }

  /**
   * Process the queue for a channel
   */
  private processQueue(channel: Channel): void {
    const queue = this.queues.get(channel);
    const processing = this.processing.get(channel) ?? 0;

    if (!queue || queue.length === 0 || processing >= this.concurrency) {
      return;
    }

    const item = queue.shift();
    if (!item) return;

    this.processing.set(channel, processing + 1);

    this.processMessage(item.message)
      .then((response) => {
        this.emit("event", { type: "message_processed", message: item.message, response: response ?? undefined });
      })
      .catch((err) => {
        this.logger.error({ error: String(err) }, "Message processing failed");
        this.emit("event", {
          type: "error",
          error: err instanceof Error ? err : new Error(String(err)),
          message: item.message,
        });
      })
      .finally(() => {
        const current = this.processing.get(channel) ?? 1;
        this.processing.set(channel, current - 1);
        this.processQueue(channel);
      });
  }

  /**
   * Process a single message through the pipeline
   */
  private async processMessage(message: NormalizedMessage): Promise<NormalizedMessage | null> {
    // Run through middleware
    const processedMessage = await this.runMiddleware(message);
    if (!processedMessage) {
      return null;
    }

    // Find matching route
    const handler = this.findHandler(processedMessage);
    if (!handler) {
      this.logger.debug({ sessionKey: processedMessage.context.sessionKey }, "No handler found");
      return null;
    }

    // Execute handler
    return handler(processedMessage);
  }

  /**
   * Run message through middleware stack
   */
  private async runMiddleware(message: NormalizedMessage): Promise<NormalizedMessage | null> {
    if (this.middleware.length === 0) {
      return message;
    }

    let index = 0;
    const next = async (): Promise<NormalizedMessage | null> => {
      if (index >= this.middleware.length) {
        return message;
      }
      const middleware = this.middleware[index++]!;
      return middleware(message, next);
    };

    return next();
  }

  /**
   * Find a handler for the message
   */
  private findHandler(message: NormalizedMessage): MessageHandler | undefined {
    for (const route of this.routes) {
      if (this.matchesRoute(message, route)) {
        return route.handler;
      }
    }
    return this.defaultHandler;
  }

  /**
   * Check if a message matches a route
   */
  private matchesRoute(message: NormalizedMessage, route: RouteConfig): boolean {
    const { pattern } = route;

    // Check channel
    if (pattern.channel) {
      const channels = Array.isArray(pattern.channel) ? pattern.channel : [pattern.channel];
      if (!channels.includes(message.channel)) {
        return false;
      }
    }

    // Check session key pattern
    if (pattern.sessionKeyPattern) {
      const regex =
        typeof pattern.sessionKeyPattern === "string"
          ? new RegExp(pattern.sessionKeyPattern)
          : pattern.sessionKeyPattern;
      if (!regex.test(message.context.sessionKey)) {
        return false;
      }
    }

    // Check priority
    if (pattern.priority) {
      const priorities = Array.isArray(pattern.priority) ? pattern.priority : [pattern.priority];
      if (!priorities.includes(message.priority)) {
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Update session from message
   */
  private updateSession(message: NormalizedMessage): void {
    const sessionKey = message.context.sessionKey;
    const existing = this.sessions.get(sessionKey);

    if (existing) {
      existing.lastActivity = message.timestamp;
      existing.messageCount += 1;
    } else {
      this.sessions.set(sessionKey, {
        sessionKey,
        channel: message.channel,
        chatId: message.context.chatId,
        threadId: message.context.threadId,
        createdAt: message.timestamp,
        lastActivity: message.timestamp,
        messageCount: 1,
        user: message.sender.isAgent
          ? undefined
          : { id: message.sender.id, name: message.sender.name },
      });
    }
  }

  /**
   * Get a session
   */
  getSession(sessionKey: string): ChannelSession | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Get all sessions
   */
  getSessions(): ChannelSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a specific channel
   */
  getSessionsByChannel(channel: Channel): ChannelSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.channel === channel);
  }

  /**
   * Remove expired sessions
   */
  private pruneExpiredSessions(): void {
    const now = Date.now();
    const cutoff = now - this.sessionTimeoutMs;
    let pruned = 0;

    for (const [key, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(key);
        pruned += 1;
      }
    }

    if (pruned > 0) {
      this.logger.debug({ pruned }, "Pruned expired sessions");
    }
  }

  // ==========================================================================
  // Outbound Messages
  // ==========================================================================

  /**
   * Send a message through the appropriate adapter
   */
  async sendMessage(message: NormalizedMessage): Promise<boolean> {
    const adapter = this.adapters.get(message.channel);
    if (!adapter) {
      this.logger.warn({ channel: message.channel }, "No adapter for channel");
      return false;
    }

    const result = await adapter.sendMessage(message);
    return result.ok;
  }

  /**
   * Send a message to a specific session
   */
  async sendToSession(
    sessionKey: string,
    content: string,
    options?: { media?: NormalizedMessage["media"] }
  ): Promise<boolean> {
    const session = this.sessions.get(sessionKey);
    if (!session) {
      this.logger.warn({ sessionKey }, "Session not found");
      return false;
    }

    const message: NormalizedMessage = {
      id: randomUUID(),
      channel: session.channel,
      sender: { id: "agent", name: "Agent", isAgent: true },
      content,
      media: options?.media,
      context: {
        sessionKey,
        chatId: session.chatId,
        threadId: session.threadId,
      },
      timestamp: Date.now(),
      priority: "normal",
    };

    return this.sendMessage(message);
  }

  // ==========================================================================
  // Queue Management
  // ==========================================================================

  /**
   * Get queue statistics
   */
  getQueueStats(): Map<Channel, { queued: number; processing: number }> {
    const stats = new Map<Channel, { queued: number; processing: number }>();

    for (const [channel, queue] of this.queues.entries()) {
      stats.set(channel, {
        queued: queue.length,
        processing: this.processing.get(channel) ?? 0,
      });
    }

    return stats;
  }

  /**
   * Wait for all queues to drain
   */
  private async drainQueues(): Promise<void> {
    const checkDrained = (): boolean => {
      for (const queue of this.queues.values()) {
        if (queue.length > 0) return false;
      }
      for (const count of this.processing.values()) {
        if (count > 0) return false;
      }
      return true;
    };

    // Wait up to 30 seconds
    const maxWait = 30_000;
    const startTime = Date.now();

    while (!checkDrained() && Date.now() - startTime < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

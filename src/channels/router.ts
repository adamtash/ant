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
import { getEventStream, createEventPublishers } from "../monitor/event-stream.js";

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

  /** Session ordering configuration */
  sessionOrdering?: {
    enabled?: boolean;
    maxConcurrentSessions?: number;
    queueTimeoutMs?: number;
  };

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
  private readonly sessionOrderingEnabled: boolean;
  private readonly maxConcurrentSessions: number;
  private readonly sessionQueueTimeoutMs: number;

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

  /** Session lane queues */
  private readonly sessionQueues: Map<string, QueuedMessage[]> = new Map();
  private readonly sessionProcessing: Map<string, number> = new Map();

  /** Typing indicator tracking: key = "channel:chatId", value = interval ID */
  private readonly typingIndicators: Map<string, NodeJS.Timeout> = new Map();

  /** Cleanup interval */
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  /** Event publishers */
  private events = createEventPublishers(getEventStream());

  constructor(config: RouterConfig) {
    super();
    this.logger = config.logger.child({ component: "router" });
    this.maxQueueSize = config.maxQueueSize ?? 1000;
    this.concurrency = config.concurrency ?? 1;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000;
    this.defaultHandler = config.defaultHandler;
    this.sessionOrderingEnabled = config.sessionOrdering?.enabled ?? true;
    this.maxConcurrentSessions = config.sessionOrdering?.maxConcurrentSessions ?? 3;
    this.sessionQueueTimeoutMs = config.sessionOrdering?.queueTimeoutMs ?? 300_000;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the router
   */
  start(): void {
    // Start cleanup interval - 10s for faster GC of expired sessions
    this.cleanupInterval = setInterval(() => {
      this.pruneExpiredSessions();
    }, 10_000);

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

    // Clear all typing indicators
    for (const interval of this.typingIndicators.values()) {
      clearInterval(interval);
    }
    this.typingIndicators.clear();

    // Wait for queues to drain
    await this.drainQueues();

    this.logger.info("Message router stopped");
  }

  // ==========================================================================
  // Typing Indicator Management
  // ==========================================================================

  /**
   * Start a persistent typing indicator
   * Sends typing every 3 seconds to keep it visible in WhatsApp
   */
  private startTypingIndicator(channel: Channel, chatId: string): void {
    const key = `${channel}:${chatId}`;
    
    // If already running, don't restart
    if (this.typingIndicators.has(key)) {
      return;
    }

    this.logger.debug({ channel, chatId }, "Starting typing indicator");

    // Send initial typing indicator
    this.sendTypingUpdate(channel, chatId, true).catch((err) => {
      this.logger.debug({ error: String(err), channel, chatId }, "Failed to send initial typing indicator");
    });

    // Refresh every 3 seconds (WhatsApp typing expires after ~30 seconds)
    const interval = setInterval(() => {
      this.sendTypingUpdate(channel, chatId, true).catch((err) => {
        this.logger.debug({ error: String(err), channel, chatId }, "Failed to refresh typing indicator");
      });
    }, 3000);

    this.typingIndicators.set(key, interval);
  }

  /**
   * Stop a typing indicator
   */
  private stopTypingIndicator(channel: Channel, chatId: string): void {
    const key = `${channel}:${chatId}`;
    const interval = this.typingIndicators.get(key);

    if (interval) {
      clearInterval(interval);
      this.typingIndicators.delete(key);
      this.logger.debug({ channel, chatId }, "Stopped typing indicator");
    }

    // Send final "paused" update to clear the indicator
    this.sendTypingUpdate(channel, chatId, false).catch((err) => {
      this.logger.debug({ error: String(err), channel, chatId }, "Failed to send paused typing update");
    });
  }

  /**
   * Send a typing update to the adapter
   */
  private async sendTypingUpdate(channel: Channel, chatId: string, isTyping: boolean): Promise<void> {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      return;
    }

    // Check if adapter has sendTyping method (WhatsApp specific)
    if (typeof (adapter as any).sendTyping === "function") {
      await (adapter as any).sendTyping(chatId, isTyping);
    }
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
  private async handleIncomingMessage(message: NormalizedMessage): Promise<void> {
    this.emit("event", { type: "message_received", message });
    
    await this.events.messageReceived({
      sender: message.sender.name || message.sender.id,
      contentPreview: message.content ? message.content.slice(0, 50) : "[Media]",
      messageLength: message.content?.length || 0
    }, { sessionKey: message.context.sessionKey, channel: message.channel });

    // Update session
    this.updateSession(message);

    // Add to queue
    const queue = this.sessionOrderingEnabled
      ? this.ensureSessionQueue(message.context.sessionKey)
      : this.queues.get(message.channel);
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
      await this.events.messageDropped({ reason: "queue_full" }, { sessionKey: message.context.sessionKey, channel: message.channel });
      this.logger.warn({ channel: message.channel }, "Queue full, dropping message");
      
      // Notify user
      await this.sendMessage({
          ...message,
          id: randomUUID(),
          content: "⚠️ System Check: Message queue is full. Please try again in a moment.",
          timestamp: Date.now(),
          priority: "high"
      });
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
    
    await this.events.messageQueued({ 
        queueLength: queue.length, 
        position: queue.indexOf(queuedMessage),
        priority: message.priority 
    }, { sessionKey: message.context.sessionKey, channel: message.channel });

    // Process queue
    if (this.sessionOrderingEnabled) {
      this.processSessionQueues();
    } else {
      this.processQueue(message.channel);
    }
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

  private ensureSessionQueue(sessionKey: string): QueuedMessage[] {
    let queue = this.sessionQueues.get(sessionKey);
    if (!queue) {
      queue = [];
      this.sessionQueues.set(sessionKey, queue);
      this.sessionProcessing.set(sessionKey, 0);
    }
    return queue;
  }

  private processSessionQueues(): void {
    let activeSessions = 0;
    for (const count of this.sessionProcessing.values()) {
      activeSessions += count;
    }
    if (activeSessions >= this.maxConcurrentSessions) {
      return;
    }
    for (const [sessionKey, queue] of this.sessionQueues.entries()) {
      if (activeSessions >= this.maxConcurrentSessions) {
        break;
      }
      if (queue.length === 0) continue;
      const processing = this.sessionProcessing.get(sessionKey) ?? 0;
      if (processing > 0) continue;

      const item = queue.shift();
      if (!item) continue;
      if (Date.now() - item.enqueuedAt > this.sessionQueueTimeoutMs) {
        this.logger.warn({ sessionKey }, "Session queue timeout exceeded, dropping message");
        continue;
      }
      this.sessionProcessing.set(sessionKey, processing + 1);
      activeSessions += 1;
      this.executeQueuedMessage(item, sessionKey);
    }
  }

  private executeQueuedMessage(item: QueuedMessage, sessionKeyOverride?: string): void {
    const channel = item.message.channel;
    const sessionKey = sessionKeyOverride ?? item.message.context.sessionKey;

    this.events.messageProcessing({ handler: "agent" }, { sessionKey, channel }).catch(() => {});

    // Start typing indicator (only if chatId is defined)
    if (item.message.context.chatId) {
      this.startTypingIndicator(channel, item.message.context.chatId);
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Timeout: Message processing took longer than ${this.sessionQueueTimeoutMs / 1000}s`
            )
          ),
        this.sessionQueueTimeoutMs
      );
    });

    Promise.race([this.processMessage(item.message), timeoutPromise])
      .then((response) => {
        const success = !!response;
        this.emit("event", { type: "message_processed", message: item.message, response: response ?? undefined });
        this.events
          .messageProcessed(
            { duration: Date.now() - item.enqueuedAt, success },
            { sessionKey, channel }
          )
          .catch(() => {});
      })
      .catch((err) => {
        this.logger.error({ error: String(err) }, "Message processing failed");
        this.emit("event", {
          type: "error",
          error: err instanceof Error ? err : new Error(String(err)),
          message: item.message,
        });
        this.events
          .errorOccurred(
            {
              errorType: "processing_failed",
              severity: "high",
              message: String(err),
              context: { sessionKey },
            },
            { sessionKey, channel }
          )
          .catch(() => {});
      })
      .finally(() => {
        // Stop typing indicator (only if chatId is defined)
        if (item.message.context.chatId) {
          this.stopTypingIndicator(channel, item.message.context.chatId);
        }

        if (this.sessionOrderingEnabled) {
          const current = this.sessionProcessing.get(sessionKey) ?? 1;
          this.sessionProcessing.set(sessionKey, Math.max(0, current - 1));
          this.processSessionQueues();
        } else {
          const current = this.processing.get(channel) ?? 1;
          this.processing.set(channel, current - 1);
          this.processQueue(channel);
        }
      });
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
    this.executeQueuedMessage(item);
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
      
      // Notify user
      await this.sendToSession(
           processedMessage.context.sessionKey, 
           "⚠️ Configuration Error: No handler found for this message."
      );
      
      await this.events.messageDropped({ reason: "no_handler" }, { sessionKey: message.context.sessionKey, channel: message.channel });
      return null;
    }

    try {
        return await handler(processedMessage);
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        
        // Notify user about error
        await this.sendToSession(
            processedMessage.context.sessionKey,
            `❌ I encountered an error: ${errorMsg}`
        );
        
        // Rethrow for queue management
        throw err;
    }
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

  /** Maximum number of sessions to prevent unbounded memory growth */
  private readonly maxSessions = 1000;

  /**
   * Remove expired sessions with LRU eviction
   */
  private pruneExpiredSessions(): void {
    const now = Date.now();
    const cutoff = now - this.sessionTimeoutMs;
    let pruned = 0;

    // Remove expired sessions
    for (const [key, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(key);
        pruned += 1;
      }
    }

    // LRU eviction if still over limit
    if (this.sessions.size > this.maxSessions) {
      const sorted = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      
      const toDelete = sorted.slice(0, this.sessions.size - this.maxSessions);
      for (const [key] of toDelete) {
        this.sessions.delete(key);
        pruned += 1;
      }
    }

    if (pruned > 0) {
      this.logger.debug({ pruned, total: this.sessions.size }, "Pruned expired sessions");
    }

    if (this.sessionOrderingEnabled) {
      for (const [sessionKey, queue] of this.sessionQueues.entries()) {
        if (
          queue.length === 0 &&
          (this.sessionProcessing.get(sessionKey) ?? 0) === 0 &&
          !this.sessions.has(sessionKey)
        ) {
          this.sessionQueues.delete(sessionKey);
          this.sessionProcessing.delete(sessionKey);
        }
      }
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

    this.logger.info({
      channel: message.channel,
      sessionKey: message.context.sessionKey,
      chatId: message.context.chatId,
      contentLength: message.content?.length || 0,
      contentPreview: message.content?.slice(0, 200) || "(empty)",
      hasMedia: !!message.media,
    }, "Router sending message to adapter");

    const result = await adapter.sendMessage(message);
    
    this.logger.info({
      channel: message.channel,
      success: result.ok,
      error: result.error,
      messageId: result.messageId,
    }, "Router sendMessage result");
    
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
    let session = this.sessions.get(sessionKey);
    
    // Attempt to recover session from key if missing
    if (!session) {
      const parts = sessionKey.split(":");
      if (parts.length >= 3) {
        const [channel, type, ...rest] = parts;
        const chatId = rest.join(":");
        
        if (channel && chatId && this.adapters.has(channel as Channel)) {
           this.logger.info({ sessionKey }, "Recovering missing session from key");
           session = {
             sessionKey,
             channel: channel as Channel,
             chatId,
             createdAt: Date.now(),
             lastActivity: Date.now(),
             messageCount: 0
           };
           // Re-add to sessions map
           this.sessions.set(sessionKey, session);
        }
      }
    }

    if (!session) {
      this.logger.warn({ sessionKey }, "Session not found and could not be recovered");
      
      // Emit error event
      await this.events.errorOccurred({
        errorType: "session_not_found",
        severity: "medium",
        message: `Could not send message to session ${sessionKey}`,
        context: { sessionKey }
      }, { sessionKey });
      
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

    if (this.sessionOrderingEnabled) {
      stats.set("cli", this.getSessionQueueStats());
      return stats;
    }

    for (const [channel, queue] of this.queues.entries()) {
      stats.set(channel, {
        queued: queue.length,
        processing: this.processing.get(channel) ?? 0,
      });
    }

    return stats;
  }

  getSessionQueueStats(): { queued: number; processing: number } {
    if (!this.sessionOrderingEnabled) {
      return { queued: 0, processing: 0 };
    }
    let queued = 0;
    let processing = 0;
    for (const queue of this.sessionQueues.values()) {
      queued += queue.length;
    }
    for (const count of this.sessionProcessing.values()) {
      processing += count;
    }
    return { queued, processing };
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
      if (this.sessionOrderingEnabled) {
        for (const queue of this.sessionQueues.values()) {
          if (queue.length > 0) return false;
        }
        for (const count of this.sessionProcessing.values()) {
          if (count > 0) return false;
        }
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

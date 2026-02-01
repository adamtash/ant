/**
 * Base Channel Adapter
 *
 * Abstract base class that all channel adapters must extend.
 * Provides common functionality for message normalization,
 * session management, and event handling.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import type {
  Channel,
  NormalizedMessage,
  ChannelContext,
  AdapterEvent,
  AdapterEventHandler,
  SendMessageOptions,
  SendResult,
  MessageMedia,
  MessagePriority,
  ChannelSession,
} from "./types.js";
import type { Logger } from "../log.js";

// ============================================================================
// Adapter Configuration
// ============================================================================

/**
 * Base configuration for all adapters
 */
export interface BaseAdapterConfig {
  /** Logger instance */
  logger: Logger;

  /** Default message priority */
  defaultPriority?: MessagePriority;

  /** Whether to track sessions */
  enableSessionTracking?: boolean;

  /** Session timeout in milliseconds */
  sessionTimeoutMs?: number;
}

// ============================================================================
// Abstract Base Adapter
// ============================================================================

/**
 * Abstract base class for channel adapters
 *
 * Subclasses must implement:
 * - start(): Initialize and connect to the channel
 * - stop(): Disconnect and cleanup
 * - sendMessage(): Send a message to the channel
 * - normalizeIncoming(): Convert channel-specific message to NormalizedMessage
 * - formatOutgoing(): Convert NormalizedMessage to channel-specific format
 */
export abstract class BaseChannelAdapter extends EventEmitter {
  /** Channel type identifier */
  abstract readonly channel: Channel;

  /** Logger instance */
  protected readonly logger: Logger;

  /** Default message priority */
  protected readonly defaultPriority: MessagePriority;

  /** Session tracking */
  protected readonly sessions: Map<string, ChannelSession> = new Map();

  /** Whether session tracking is enabled */
  protected readonly enableSessionTracking: boolean;

  /** Session timeout in ms */
  protected readonly sessionTimeoutMs: number;

  /** Current connection state */
  protected connected: boolean = false;

  /** Event handlers */
  private readonly eventHandlers: Set<AdapterEventHandler> = new Set();

  constructor(config: BaseAdapterConfig) {
    super();
    // Note: this.channel will be set by subclass before logger is used
    this.logger = config.logger.child({ component: "adapter" });
    this.defaultPriority = config.defaultPriority ?? "normal";
    this.enableSessionTracking = config.enableSessionTracking ?? true;
    this.sessionTimeoutMs = config.sessionTimeoutMs ?? 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Initialize the logger with the channel name (called by subclass after channel is set)
   */
  protected initLogger(config: BaseAdapterConfig): void {
    (this as any).logger = config.logger.child({ component: `adapter:${this.channel}` });
  }

  // ==========================================================================
  // Abstract Methods (must be implemented by subclasses)
  // ==========================================================================

  /**
   * Start the adapter and connect to the channel
   */
  abstract start(): Promise<void>;

  /**
   * Stop the adapter and disconnect from the channel
   */
  abstract stop(): Promise<void>;

  /**
   * Send a normalized message to the channel
   */
  abstract sendMessage(
    message: NormalizedMessage,
    options?: SendMessageOptions
  ): Promise<SendResult>;

  /**
   * Convert a channel-specific message to NormalizedMessage format
   */
  protected abstract normalizeIncoming(rawMessage: unknown): NormalizedMessage | null;

  /**
   * Convert a NormalizedMessage to channel-specific format for sending
   */
  protected abstract formatOutgoing(message: NormalizedMessage): unknown;

  // ==========================================================================
  // Common Methods
  // ==========================================================================

  /**
   * Check if the adapter is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the current channel context
   */
  getContext(): ChannelContext {
    return {
      channel: this.channel,
      connected: this.connected,
      lastActivity: this.getLastActivity(),
    };
  }

  /**
   * Get all active sessions
   */
  getSessions(): ChannelSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get a specific session
   */
  getSession(sessionKey: string): ChannelSession | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Register an event handler
   */
  onEvent(handler: AdapterEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  // ==========================================================================
  // Protected Helper Methods
  // ==========================================================================

  /**
   * Emit an adapter event to all handlers
   */
  protected emitEvent(event: AdapterEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            this.logger.warn(
              { error: err instanceof Error ? err.message : String(err) },
              "Event handler error"
            );
          });
        }
      } catch (err) {
        this.logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "Event handler error"
        );
      }
    }

    // Also emit on EventEmitter for compatibility
    this.emit(event.type, event);
  }

  /**
   * Handle an incoming message from the channel
   *
   * This should be called by subclasses when they receive a message
   */
  protected handleIncomingMessage(rawMessage: unknown): void {
    try {
      const normalized = this.normalizeIncoming(rawMessage);
      if (!normalized) {
        this.logger.debug("Message filtered out during normalization");
        return;
      }

      // Update session tracking
      if (this.enableSessionTracking) {
        this.updateSession(normalized);
      }

      // Emit the message event
      this.emitEvent({ type: "message", message: normalized });
    } catch (err) {
      this.logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to process incoming message"
      );
      this.emitEvent({
        type: "error",
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  /**
   * Generate a unique message ID
   */
  protected generateMessageId(): string {
    return randomUUID();
  }

  /**
   * Generate a session key from context
   */
  protected generateSessionKey(chatId?: string, threadId?: string): string {
    const parts: string[] = [this.channel];
    if (chatId) parts.push(chatId);
    if (threadId) parts.push(threadId);
    return parts.join(":");
  }

  /**
   * Update session tracking for a message
   */
  protected updateSession(message: NormalizedMessage): void {
    const sessionKey = message.context.sessionKey;
    const existing = this.sessions.get(sessionKey);

    if (existing) {
      existing.lastActivity = message.timestamp;
      existing.messageCount += 1;
    } else {
      this.sessions.set(sessionKey, {
        sessionKey,
        channel: this.channel,
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

    // Prune old sessions
    this.pruneExpiredSessions();
  }

  /**
   * Remove expired sessions
   */
  protected pruneExpiredSessions(): void {
    const now = Date.now();
    const cutoff = now - this.sessionTimeoutMs;

    for (const [key, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoff) {
        this.sessions.delete(key);
        this.logger.debug({ sessionKey: key }, "Session expired");
      }
    }
  }

  /**
   * Get the timestamp of the last activity across all sessions
   */
  protected getLastActivity(): number | undefined {
    let latest: number | undefined;
    for (const session of this.sessions.values()) {
      if (latest === undefined || session.lastActivity > latest) {
        latest = session.lastActivity;
      }
    }
    return latest;
  }

  /**
   * Handle connection state change
   */
  protected setConnected(connected: boolean, reason?: string): void {
    const wasConnected = this.connected;
    this.connected = connected;

    if (connected && !wasConnected) {
      this.logger.info("Channel connected");
      this.emitEvent({ type: "connected", context: this.getContext() });
    } else if (!connected && wasConnected) {
      this.logger.info({ reason }, "Channel disconnected");
      this.emitEvent({ type: "disconnected", reason });
    }
  }

  /**
   * Create a normalized message with defaults
   */
  protected createNormalizedMessage(
    partial: Partial<NormalizedMessage> & {
      content: string;
      sender: NormalizedMessage["sender"];
      context: NormalizedMessage["context"];
    }
  ): NormalizedMessage {
    return {
      id: partial.id ?? this.generateMessageId(),
      channel: partial.channel ?? this.channel,
      sender: partial.sender,
      content: partial.content,
      media: partial.media,
      context: partial.context,
      timestamp: partial.timestamp ?? Date.now(),
      isReply: partial.isReply,
      priority: partial.priority ?? this.defaultPriority,
      rawMessage: partial.rawMessage,
    };
  }

  /**
   * Normalize media from various formats
   */
  protected normalizeMedia(
    data: Buffer | string | undefined,
    type?: "image" | "video" | "audio" | "file",
    mimeType?: string,
    filename?: string
  ): MessageMedia | undefined {
    if (!data) return undefined;

    return {
      type: type ?? "file",
      data,
      mimeType,
      filename,
    };
  }
}

/**
 * Helper type for adapter constructors
 */
export type AdapterConstructor<T extends BaseChannelAdapter> = new (
  config: BaseAdapterConfig & Record<string, unknown>
) => T;

/**
 * Multi-Channel Interface Types
 *
 * Defines normalized message format and channel context types
 * for unified message handling across different channels.
 */

// ============================================================================
// Channel Types
// ============================================================================

/**
 * Supported channel types
 */
export type Channel = "whatsapp" | "cli" | "web" | "telegram" | "discord";

/**
 * Message priority levels
 */
export type MessagePriority = "high" | "normal" | "low";

/**
 * Media types supported across channels
 */
export type MediaType = "image" | "video" | "audio" | "file";

// ============================================================================
// Normalized Message Format
// ============================================================================

/**
 * Sender information
 */
export interface MessageSender {
  id: string;
  name: string;
  isAgent: boolean;
}

/**
 * Media attachment
 */
export interface MessageMedia {
  type: MediaType;
  data: Buffer | string;
  mimeType?: string;
  filename?: string;
}

/**
 * Message context for session/thread tracking
 */
export interface MessageContext {
  sessionKey: string;
  chatId?: string;
  threadId?: string;
}

/**
 * Normalized message format that all channels convert to/from
 *
 * This is the canonical message format used internally by the agent system.
 * Each channel adapter is responsible for converting to/from this format.
 */
export interface NormalizedMessage {
  /** Unique message identifier */
  id: string;

  /** Source/destination channel */
  channel: Channel;

  /** Sender information */
  sender: MessageSender;

  /** Text content of the message */
  content: string;

  /** Optional media attachment */
  media?: MessageMedia;

  /** Session and conversation context */
  context: MessageContext;

  /** Unix timestamp in milliseconds */
  timestamp: number;

  /** Whether this is a reply to another message */
  isReply?: boolean;

  /** Message priority for queue ordering */
  priority: MessagePriority;

  /** Original raw message from the channel (for debugging) */
  rawMessage?: unknown;
}

// ============================================================================
// Channel Context
// ============================================================================

/**
 * Channel-specific metadata and state
 */
export interface ChannelContext {
  /** Channel identifier */
  channel: Channel;

  /** Whether the channel is currently connected */
  connected: boolean;

  /** Channel-specific connection info */
  connectionInfo?: {
    userId?: string;
    username?: string;
    displayName?: string;
  };

  /** Last activity timestamp */
  lastActivity?: number;

  /** Channel-specific metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Adapter Events
// ============================================================================

/**
 * Events emitted by channel adapters
 */
export type AdapterEvent =
  | { type: "message"; message: NormalizedMessage }
  | { type: "connected"; context: ChannelContext }
  | { type: "disconnected"; reason?: string }
  | { type: "error"; error: Error }
  | { type: "typing"; chatId: string; isTyping: boolean };

/**
 * Event handler type
 */
export type AdapterEventHandler = (event: AdapterEvent) => void | Promise<void>;

// ============================================================================
// Send Options
// ============================================================================

/**
 * Options for sending messages
 */
export interface SendMessageOptions {
  /** Reply to a specific message */
  replyTo?: string;

  /** Override the default priority */
  priority?: MessagePriority;

  /** Channel-specific options */
  channelOptions?: Record<string, unknown>;
}

/**
 * Result of a send operation
 */
export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  timestamp?: number;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session state tracked by adapters
 */
export interface ChannelSession {
  /** Unique session key */
  sessionKey: string;

  /** Channel this session belongs to */
  channel: Channel;

  /** Chat/conversation identifier */
  chatId?: string;

  /** Thread identifier (for threaded conversations) */
  threadId?: string;

  /** When the session was created */
  createdAt: number;

  /** Last activity in this session */
  lastActivity: number;

  /** Number of messages in session */
  messageCount: number;

  /** User info associated with session */
  user?: {
    id: string;
    name: string;
  };

  /** Session metadata */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Routing Types
// ============================================================================

/**
 * Message handler function type
 */
export type MessageHandler = (
  message: NormalizedMessage
) => Promise<NormalizedMessage | null>;

/**
 * Route configuration for message routing
 */
export interface RouteConfig {
  /** Pattern to match (channel, session key pattern, etc.) */
  pattern: {
    channel?: Channel | Channel[];
    sessionKeyPattern?: RegExp | string;
    priority?: MessagePriority | MessagePriority[];
  };

  /** Handler for matched messages */
  handler: MessageHandler;

  /** Route priority (higher = checked first) */
  priority?: number;
}

/**
 * Queue item for pending messages
 */
export interface QueuedMessage {
  message: NormalizedMessage;
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

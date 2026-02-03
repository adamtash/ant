/**
 * Multi-Channel Interfaces
 *
 * Provides a unified interface for handling messages across
 * multiple channels (WhatsApp, CLI, Web, etc.)
 */

// Types
export type {
  Channel,
  MessagePriority,
  MediaType,
  MessageSender,
  MessageMedia,
  MessageContext,
  NormalizedMessage,
  ChannelContext,
  AdapterEvent,
  AdapterEventHandler,
  SendMessageOptions,
  SendResult,
  ChannelSession,
  MessageHandler,
  RouteConfig,
  QueuedMessage,
} from "./types.js";

// Base Adapter
export {
  BaseChannelAdapter,
  type BaseAdapterConfig,
  type AdapterConstructor,
} from "./base-adapter.js";

// Router
export {
  MessageRouter,
  type RouterConfig,
  type MiddlewareFunction,
  type RouterEvent,
} from "./router.js";

// WhatsApp Adapter
export {
  WhatsAppAdapter,
  type WhatsAppAdapterConfig,
} from "./whatsapp/adapter.js";
export { TestWhatsAppAdapter } from "./whatsapp/test-adapter.js";
export {
  extractTextFromMessage,
  extractMentions,
  extractMediaInfo,
  extractSenderInfo,
  hasKeywordMention,
  isGroupJid,
  isBroadcastJid,
  isStatusJid,
  normalizeJid,
  inferMediaType,
  inferMimeType,
  toNormalizedMedia,
  type WhatsAppMediaInfo,
} from "./whatsapp/message-handler.js";

// CLI Adapter
export {
  CLIAdapter,
  type CLIAdapterConfig,
} from "./cli/adapter.js";
export {
  CLISessionManager,
  type CLISessionManagerConfig,
  type CLISession,
} from "./cli/session-manager.js";

// Web Adapter
export {
  WebAdapter,
  type WebAdapterConfig,
} from "./web/adapter.js";
export {
  WebServer,
  type WebServerConfig,
  type WebMessageRequest,
  type WebMessageResponse,
  type WebSessionInfo,
} from "./web/server.js";

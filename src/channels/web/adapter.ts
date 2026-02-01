/**
 * Web Channel Adapter
 *
 * Provides a web-based interface for interacting with the agent.
 * Uses an Express-like HTTP server with optional WebSocket support.
 */

import { BaseChannelAdapter, type BaseAdapterConfig } from "../base-adapter.js";
import type {
  Channel,
  NormalizedMessage,
  SendMessageOptions,
  SendResult,
} from "../types.js";
import { WebServer, type WebServerConfig } from "./server.js";

// ============================================================================
// Configuration
// ============================================================================

export interface WebAdapterConfig extends BaseAdapterConfig {
  /** Port to listen on */
  port?: number;

  /** Host to bind to */
  host?: string;

  /** CORS origin */
  corsOrigin?: string;

  /** API key for authentication */
  apiKey?: string;

  /** Enable WebSocket support */
  enableWebSocket?: boolean;
}

// ============================================================================
// Web Adapter
// ============================================================================

export class WebAdapter extends BaseChannelAdapter {
  readonly channel: Channel = "web";

  private readonly server: WebServer;
  private readonly port: number;
  private readonly host: string;

  constructor(config: WebAdapterConfig) {
    super(config);

    this.port = config.port ?? 3000;
    this.host = config.host ?? "0.0.0.0";

    const serverConfig: WebServerConfig = {
      logger: this.logger,
      port: this.port,
      host: this.host,
      corsOrigin: config.corsOrigin,
      apiKey: config.apiKey,
      enableWebSocket: config.enableWebSocket ?? true,
    };

    this.server = new WebServer(serverConfig);

    // Forward message events from server
    this.server.on("message", (message: NormalizedMessage) => {
      this.handleIncomingMessage(message);
    });
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async start(): Promise<void> {
    this.logger.info({ host: this.host, port: this.port }, "Starting Web adapter...");

    await this.server.start();
    this.setConnected(true);
  }

  async stop(): Promise<void> {
    this.logger.info("Stopping Web adapter...");

    await this.server.stop();
    this.setConnected(false, "stopped");
  }

  getStatus(): Record<string, any> {
    return {
      connected: this.isConnected(),
      address: this.getAddress(),
    };
  }

  // ==========================================================================
  // Message Handling
  // ==========================================================================

  async sendMessage(
    message: NormalizedMessage,
    _options?: SendMessageOptions
  ): Promise<SendResult> {
    const sessionId = message.context.chatId;
    if (!sessionId) {
      return { ok: false, error: "No session ID specified" };
    }

    return this.server.sendToSession(sessionId, message);
  }

  /**
   * Broadcast a message to all connected web clients
   */
  broadcast(message: NormalizedMessage): void {
    this.server.broadcast(message);
  }

  protected normalizeIncoming(rawMessage: unknown): NormalizedMessage | null {
    // The server already normalizes incoming messages
    // This is called when we receive a pre-normalized message
    if (this.isNormalizedMessage(rawMessage)) {
      return rawMessage;
    }
    return null;
  }

  protected formatOutgoing(message: NormalizedMessage): object {
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
          }
        : undefined,
    };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the server instance for custom configuration
   */
  getServer(): WebServer {
    return this.server;
  }

  /**
   * Get the server address
   */
  getAddress(): { host: string; port: number } | null {
    return this.server.getAddress();
  }

  /**
   * Create a message to send
   */
  createAgentMessage(
    content: string,
    sessionId: string,
    options?: {
      threadId?: string;
      media?: NormalizedMessage["media"];
    }
  ): NormalizedMessage {
    return this.createNormalizedMessage({
      content,
      sender: {
        id: "agent",
        name: "ANT Agent",
        isAgent: true,
      },
      context: {
        sessionKey: `web:${sessionId}`,
        chatId: sessionId,
        threadId: options?.threadId,
      },
      media: options?.media,
      priority: "normal",
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private isNormalizedMessage(obj: unknown): obj is NormalizedMessage {
    if (!obj || typeof obj !== "object") return false;
    const msg = obj as Record<string, unknown>;
    return (
      typeof msg.id === "string" &&
      typeof msg.channel === "string" &&
      typeof msg.content === "string" &&
      typeof msg.sender === "object" &&
      typeof msg.context === "object" &&
      typeof msg.timestamp === "number"
    );
  }
}

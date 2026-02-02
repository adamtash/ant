/**
 * WhatsApp Client
 *
 * Provides WhatsApp connectivity using @whiskeysockets/baileys.
 * Handles connection management, message sending, and event handling.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { EventEmitter } from "node:events";

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
  type AnyMessageContent,
  type ConnectionState,
  type MessageUpsertType,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

import type { AntConfig } from "../../config.js";
import type { Logger } from "../../log.js";
import { inferMimeType } from "./message-handler.js";

// ============================================================================
// Types
// ============================================================================

export interface WhatsAppClientConfig {
  /** ANT configuration */
  cfg: AntConfig;

  /** Pino logger instance */
  logger: Logger;

  /** Callback for incoming messages */
  onMessage?: (message: InboundMessage) => Promise<void>;

  /** Callback for connection status updates */
  onStatus?: (status: ConnectionStatus) => void;

  /** Callback for socket errors */
  onError?: (error: Error) => void;
}

export interface InboundMessage {
  /** The raw WhatsApp message */
  message: WAMessage;

  /** Message type classification */
  type: MessageUpsertType;
}

export interface ConnectionStatus {
  /** Connection state: 'open', 'connecting', or 'close' */
  connection?: string;

  /** QR code string for authentication */
  qr?: string;

  /** Whether the user has logged out */
  loggedOut?: boolean;

  /** Disconnect status code */
  statusCode?: number;
}

export interface SendMediaOptions {
  /** File path to the media */
  filePath: string;

  /** Media type */
  type: "image" | "video" | "document";

  /** Optional caption */
  caption?: string;
}

export interface WhatsAppClientEvents {
  message: (message: InboundMessage) => void;
  connection: (status: ConnectionStatus) => void;
  error: (error: Error) => void;
}

// ============================================================================
// WhatsApp Client Class
// ============================================================================

export class WhatsAppClient extends EventEmitter {
  private socket: WASocket | null = null;
  private readonly cfg: AntConfig;
  private readonly logger: Logger;
  private readonly onMessage?: (message: InboundMessage) => Promise<void>;
  private readonly onStatus?: (status: ConnectionStatus) => void;
  private selfJid: string | undefined;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private isClosing = false;
  private lastQr: string | undefined;
  private lastConnectionStatus: ConnectionStatus = { connection: "close" };

  private readonly onError?: (error: Error) => void;

  constructor(config: WhatsAppClientConfig) {
    super();
    this.cfg = config.cfg;
    this.logger = config.logger.child({ module: "whatsapp-client" });
    this.onMessage = config.onMessage;
    this.onStatus = config.onStatus;
    this.onError = config.onError;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Connect to WhatsApp
   */
  async connect(): Promise<void> {
    this.isClosing = false;
    await this.initSocket();
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    this.isClosing = true;

    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch (err) {
        this.logger.debug({ err }, "Error closing socket");
      }
      this.socket = null;
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.socket !== null;
  }

  /**
   * Get the bot's own JID
   */
  getSelfJid(): string | undefined {
    return this.selfJid;
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.lastConnectionStatus;
  }

  // ==========================================================================
  // Message Sending
  // ==========================================================================

  /**
   * Send a text message
   */
  async sendText(jid: string, text: string): Promise<WAMessage | undefined> {
    this.ensureConnected();
    return this.socket!.sendMessage(jid, { text });
  }

  /**
   * Send a media message (image, video, or document)
   */
  async sendMedia(jid: string, options: SendMediaOptions): Promise<WAMessage | undefined> {
    this.ensureConnected();

    const { filePath, type, caption } = options;
    const buffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);

    let content: AnyMessageContent;

    switch (type) {
      case "image":
        content = {
          image: buffer,
          caption,
          mimetype: inferMimeType(filePath, "image"),
        };
        break;
      case "video":
        content = {
          video: buffer,
          caption,
          mimetype: inferMimeType(filePath, "video"),
        };
        break;
      case "document":
      default:
        content = {
          document: buffer,
          fileName: filename,
          caption,
          mimetype: inferMimeType(filePath, "document") ?? "application/octet-stream",
        };
        break;
    }

    return this.socket!.sendMessage(jid, content);
  }

  /**
   * Send a typing indicator
   */
  async sendTyping(jid: string, isTyping: boolean): Promise<void> {
    this.ensureConnected();
    await this.socket!.sendPresenceUpdate(isTyping ? "composing" : "paused", jid);
  }

  /**
   * Send read receipt
   */
  async sendReadReceipt(jid: string, messageIds: string[]): Promise<void> {
    this.ensureConnected();
    await this.socket!.readMessages([
      ...messageIds.map((id) => ({ remoteJid: jid, id })),
    ]);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async initSocket(): Promise<void> {
    const sessionDir = this.cfg.resolved.whatsappSessionDir;
    await fs.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      logger: this.logger as unknown as Parameters<typeof makeWASocket>[0]["logger"],
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger as unknown as Logger),
      },
      generateHighQualityLinkPreview: true,
    });

    this.socket = socket;

    // Handle credential updates
    socket.ev.on("creds.update", saveCreds);

    // Handle connection state changes
    socket.ev.on("connection.update", (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update);
    });

    // Handle incoming messages
    socket.ev.on("messages.upsert", (event: BaileysEventMap["messages.upsert"]) => {
      this.handleMessagesUpsert(event);
    });
  }

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update;

    const status: ConnectionStatus = { ...this.lastConnectionStatus };

    if (qr) {
      status.qr = qr;
      this.lastQr = qr;
      this.logger.info("QR code received, scan to authenticate");
    }

    if (connection) {
      status.connection = connection;

      if (connection === "open") {
        this.selfJid = this.socket?.user?.id;
        this.reconnectAttempts = 0;
        status.qr = undefined; // Clear QR on connect
        this.lastQr = undefined;
        this.logger.info({ selfJid: this.selfJid }, "WhatsApp connected");
      }

      if (connection === "close") {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        status.loggedOut = loggedOut;
        status.statusCode = statusCode;
        // Don't clear QR immediately on close/reconnect unless explicit
        if (loggedOut) {
            status.qr = undefined;
        }

        this.logger.info(
          { statusCode, loggedOut },
          "WhatsApp connection closed"
        );

        // Propagate socket errors via onError callback
        if (error && !loggedOut && this.onError) {
          const errorMessage = error.message || `Connection closed with status ${statusCode}`;
          this.onError(new Error(errorMessage));
        }

        if (loggedOut && this.cfg.whatsapp.resetOnLogout) {
          this.handleLogout();
        } else if (!this.isClosing) {
          this.handleReconnect();
        }
      }
    }
    
    this.lastConnectionStatus = status;

    // Emit status update
    this.onStatus?.(status);
    this.emit("connection", status);
  }

  private handleMessagesUpsert(event: BaileysEventMap["messages.upsert"]): void {
    const { messages, type } = event;

    for (const message of messages) {
      // Skip if no content
      if (!message.message) continue;

      const inbound: InboundMessage = { message, type };

      // Call the callback if provided
      this.onMessage?.(inbound)?.catch((err: unknown) => {
        this.logger.error({ err }, "Error handling incoming message");
      });

      // Also emit event
      this.emit("message", inbound);
    }
  }

  private async handleLogout(): Promise<void> {
    this.logger.warn("Logged out, clearing session...");
    const sessionDir = this.cfg.resolved.whatsappSessionDir;

    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
      this.logger.info("Session cleared");
    } catch (err) {
      this.logger.error({ err }, "Failed to clear session");
    }
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error("Max reconnect attempts reached, giving up");
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 300000);

    this.logger.info(
      { attempt: this.reconnectAttempts, delay },
      "Scheduling reconnect..."
    );

    setTimeout(() => {
      if (!this.isClosing) {
        this.initSocket().catch((err: unknown) => {
          this.logger.error({ err }, "Reconnect failed");
          this.handleReconnect();
        });
      }
    }, delay);
  }

  private ensureConnected(): void {
    if (!this.socket) {
      throw new Error("WhatsApp client is not connected");
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Start a WhatsApp client and connect
 */
export async function startWhatsApp(
  config: WhatsAppClientConfig
): Promise<WhatsAppClient> {
  const client = new WhatsAppClient(config);
  await client.connect();
  return client;
}

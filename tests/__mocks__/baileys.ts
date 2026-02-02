/**
 * Mock Baileys Module
 *
 * Provides mock implementations for @whiskeysockets/baileys
 */

import { vi } from "vitest";
import { proto } from "@whiskeysockets/baileys";
import type { WAMessage, AnyMessageContent, WAConnectionState } from "@whiskeysockets/baileys";

const mockUseMultiFileAuthState = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    state: {
      creds: {
        me: { id: "mock-me@s.whatsapp.net", name: "Mock User" },
        platform: "web",
      },
      keys: {},
    },
    saveCreds: vi.fn().mockResolvedValue(undefined),
  })
);

const mockDisconnectReason = vi.hoisted(() => ({
  connectionLost: 408,
  connectionReplaced: 440,
  connectionClosed: 428,
  timedOut: 408,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
}));

const mockBrowsers = vi.hoisted(() => ({
  macOS: ["Chrome (macOS)", "", ""],
  ubuntu: ["Chrome (Linux)", "", ""],
  windows: ["Chrome (Windows)", "", ""],
}));

const mockFetchLatestBaileysVersion = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ version: [2, 3000, 1015901307], isLatest: true })
);

// ============================================================================
// Mock Types
// ============================================================================

export interface MockWASocket {
  ev: MockEventEmitter;
  ws: WebSocket;
  sendMessage: ReturnType<typeof vi.fn>;
  sendPresenceUpdate: ReturnType<typeof vi.fn>;
  groupMetadata: ReturnType<typeof vi.fn>;
  profilePictureUrl: ReturnType<typeof vi.fn>;
  onWhatsApp: ReturnType<typeof vi.fn>;
  user: { id: string; name: string } | undefined;
  end: ReturnType<typeof vi.fn>;
}

export interface MockEventEmitter {
  handlers: Map<string, Array<(...args: unknown[]) => void>>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
}

// ============================================================================
// Mock Factory Functions
// ============================================================================

export function createMockEventEmitter(): MockEventEmitter {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  return {
    handlers,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event)!.push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        const index = eventHandlers.indexOf(handler);
        if (index > -1) {
          eventHandlers.splice(index, 1);
        }
      }
    }),
    emit: (event: string, ...args: unknown[]) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        for (const handler of eventHandlers) {
          handler(...args);
        }
      }
    },
  };
}

export function createMockWASocket(): MockWASocket {
  const socket = {
    ev: createMockEventEmitter(),
    ws: {} as WebSocket,
    sendMessage: vi.fn().mockResolvedValue({ key: { id: "mock-msg-id" } }),
    sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    groupMetadata: vi.fn().mockResolvedValue({}),
    profilePictureUrl: vi.fn().mockResolvedValue(null),
    onWhatsApp: vi.fn().mockResolvedValue([]),
    user: { id: "mock-user@s.whatsapp.net", name: "Test User" },
    end: vi.fn(),
  };
  setTimeout(() => {
    socket.ev.emit("connection.update", { connection: "open" });
  }, 0);
  return socket;
}

// ============================================================================
// Mock Message Factory
// ============================================================================

export function createMockWAMessage(options: {
  text?: string;
  fromMe?: boolean;
  remoteJid?: string;
  participant?: string;
  id?: string;
  timestamp?: number;
  messageType?:
    | "conversation"
    | "extendedTextMessage"
    | "imageMessage"
    | "videoMessage"
    | "audioMessage"
    | "documentMessage";
  caption?: string;
  pushName?: string;
  mentions?: string[];
} = {}): WAMessage {
  const {
    text = "Hello, this is a test message",
    fromMe = false,
    remoteJid = "1234567890@s.whatsapp.net",
    participant,
    id = `mock-${Date.now()}`,
    timestamp = Math.floor(Date.now() / 1000),
    messageType = "conversation",
    caption,
    pushName = "Test User",
    mentions = [],
  } = options;

  const message: proto.IMessage = {};

  switch (messageType) {
    case "conversation":
      message.conversation = text;
      break;
    case "extendedTextMessage":
      message.extendedTextMessage = {
        text,
        contextInfo: {
          mentionedJid: mentions,
        },
      };
      break;
    case "imageMessage":
      message.imageMessage = {
        caption: caption || text,
        mimetype: "image/jpeg",
        url: "https://example.com/image.jpg",
      };
      break;
    case "videoMessage":
      message.videoMessage = {
        caption: caption || text,
        mimetype: "video/mp4",
      };
      break;
    case "audioMessage":
      message.audioMessage = {
        mimetype: "audio/ogg",
        ptt: true,
      };
      break;
    case "documentMessage":
      message.documentMessage = {
        caption: caption || text,
        mimetype: "application/pdf",
        fileName: "document.pdf",
      };
      break;
  }

  return {
    key: {
      remoteJid,
      fromMe,
      id,
      participant,
    },
    message,
    messageTimestamp: timestamp,
    pushName,
    status: proto.WebMessageInfo.Status.DELIVERY_ACK,
  } as WAMessage;
}

export function createMockGroupMessage(options: {
  text?: string;
  fromMe?: boolean;
  groupJid?: string;
  participant?: string;
  id?: string;
  mentions?: string[];
} = {}): WAMessage {
  const {
    text = "Hello group",
    fromMe = false,
    groupJid = "1234567890@g.us",
    participant = "participant@s.whatsapp.net",
    id = `mock-group-${Date.now()}`,
    mentions = [],
  } = options;

  return createMockWAMessage({
    text,
    fromMe,
    remoteJid: groupJid,
    participant,
    id,
    messageType: "extendedTextMessage",
    mentions,
  });
}

// ============================================================================
// Mock Connection Functions
// ============================================================================

export { mockUseMultiFileAuthState, mockDisconnectReason, mockBrowsers, mockFetchLatestBaileysVersion };

// ============================================================================
// Helper Functions
// ============================================================================

export function simulateIncomingMessage(
  mockSocket: MockWASocket,
  message: WAMessage
): void {
  mockSocket.ev.emit("messages.upsert", {
    messages: [message],
    type: "notify",
  });
}

export function simulateConnectionUpdate(
  mockSocket: MockWASocket,
  update: { connection?: WAConnectionState; qr?: string; receivedPendingNotifications?: boolean }
): void {
  mockSocket.ev.emit("connection.update", update);
}

export function simulateGroupJoin(
  mockSocket: MockWASocket,
  groupJid: string,
  participants: string[]
): void {
  mockSocket.ev.emit("group-participants.update", {
    id: groupJid,
    participants,
    action: "add",
  });
}

// ============================================================================
// Module Mock
// ============================================================================
vi.mock("@whiskeysockets/baileys", async () => {
  const actual = await vi.importActual<typeof import("@whiskeysockets/baileys")>(
    "@whiskeysockets/baileys"
  );
  const mockMakeWASocket = vi.fn().mockReturnValue(createMockWASocket());
  return {
    ...actual,
    default: mockMakeWASocket,
    makeWASocket: mockMakeWASocket,
    useMultiFileAuthState: mockUseMultiFileAuthState,
    DisconnectReason: mockDisconnectReason,
    fetchLatestBaileysVersion: mockFetchLatestBaileysVersion,
    Browsers: mockBrowsers,
    areJidsSameUser: (jid1: string, jid2: string) => {
      // Simple comparison for tests
      const normalize = (jid: string) => jid.split(":")[0]!.split("/")[0]!.toLowerCase();
      return normalize(jid1) === normalize(jid2);
    },
  };
});

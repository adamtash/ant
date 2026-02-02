/**
 * WhatsApp Integration Testing Utility
 *
 * Tests WhatsApp message handling and routing.
 */

import type { Logger } from "../log.js";
import type { WAMessage } from "@whiskeysockets/baileys";

export interface WhatsAppTestResult {
  test: string;
  status: "pass" | "fail" | "skip";
  durationMs: number;
  error?: string;
  details?: unknown;
}

export interface WhatsAppTestSuite {
  name: string;
  results: WhatsAppTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface WhatsAppTesterConfig {
  gatewayUrl: string;
  timeoutMs?: number;
  logger?: Logger;
}

/**
 * Run a single WhatsApp test
 */
async function runTest(
  name: string,
  testFn: () => Promise<unknown>,
  timeoutMs: number
): Promise<WhatsAppTestResult> {
  const startTime = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Test timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    const details = await Promise.race([testFn(), timeoutPromise]);
    const durationMs = Date.now() - startTime;

    return {
      test: name,
      status: "pass",
      durationMs,
      details,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      test: name,
      status: "fail",
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Test WhatsApp channel availability
 */
async function testChannelAvailability(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/channels`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error("Failed to retrieve channels");
  }

  const whatsappChannel = data.channels.find((c: { id: string }) => c.id === "whatsapp");

  if (!whatsappChannel) {
    throw new Error("WhatsApp channel not registered");
  }

  return {
    available: true,
    connected: whatsappChannel.status?.connected ?? false,
    status: whatsappChannel.status,
  };
}

/**
 * Test WhatsApp configuration
 */
async function testWhatsAppConfiguration(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/config`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();

  if (!data.config.whatsapp) {
    throw new Error("WhatsApp configuration not found");
  }

  const config = data.config.whatsapp;

  return {
    hasSessionDir: !!config.sessionDir,
    respondToGroups: config.respondToGroups,
    mentionOnly: config.mentionOnly,
    respondToSelfOnly: config.respondToSelfOnly,
    allowSelfMessages: config.allowSelfMessages,
    botName: config.botName,
    mentionKeywords: config.mentionKeywords,
  };
}

/**
 * Test message normalization logic
 */
async function testMessageNormalization(): Promise<unknown> {
  // Import and test the message handler functions
  const { extractTextFromMessage, isGroupJid, normalizeJid, extractSenderInfo } = await import(
    "../channels/whatsapp/message-handler.js"
  );

  // Test conversation message
  const conversationMsg = {
    message: { conversation: "Hello world" },
  } as WAMessage;

  if (extractTextFromMessage(conversationMsg) !== "Hello world") {
    throw new Error("Conversation text extraction failed");
  }

  // Test extended text message
  const extendedMsg = {
    message: { extendedTextMessage: { text: "Extended text" } },
  } as WAMessage;

  if (extractTextFromMessage(extendedMsg) !== "Extended text") {
    throw new Error("Extended text extraction failed");
  }

  // Test group JID detection
  if (!isGroupJid("1234567890@g.us")) {
    throw new Error("Group JID detection failed");
  }

  if (isGroupJid("1234567890@s.whatsapp.net")) {
    throw new Error("Non-group JID incorrectly detected as group");
  }

  // Test JID normalization
  if (normalizeJid("USER@S.WHATSAPP.NET") !== "user@s.whatsapp.net") {
    throw new Error("JID normalization failed");
  }

  // Test sender info extraction
  const senderMsg = {
    key: { remoteJid: "sender@s.whatsapp.net", fromMe: false },
    pushName: "Test User",
  } as WAMessage;

  const senderInfo = extractSenderInfo(senderMsg);
  if (senderInfo.id !== "sender@s.whatsapp.net") {
    throw new Error("Sender ID extraction failed");
  }

  return {
    textExtraction: "ok",
    groupDetection: "ok",
    jidNormalization: "ok",
    senderExtraction: "ok",
  };
}

/**
 * Test mention detection
 */
async function testMentionDetection(): Promise<unknown> {
  const { hasKeywordMention, extractMentions } = await import(
    "../channels/whatsapp/message-handler.js"
  );

  // Test keyword mention
  if (!hasKeywordMention("Hello bot", ["bot"])) {
    throw new Error("Keyword mention detection failed");
  }

  if (hasKeywordMention("Hello world", ["bot"])) {
    throw new Error("False positive in keyword mention detection");
  }

  // Test mention extraction
  const mentionMsg = {
    message: {
      extendedTextMessage: {
        text: "Hello @user1",
        contextInfo: {
          mentionedJid: ["user1@s.whatsapp.net"],
        },
      },
    },
  } as WAMessage;

  const mentions = extractMentions(mentionMsg);
  if (!mentions.includes("user1@s.whatsapp.net")) {
    throw new Error("Mention extraction failed");
  }

  return {
    keywordMention: "ok",
    mentionExtraction: "ok",
  };
}

/**
 * Test media handling
 */
async function testMediaHandling(): Promise<unknown> {
  const { extractMediaInfo, inferMediaType, inferMimeType } = await import(
    "../channels/whatsapp/message-handler.js"
  );

  // Test image detection
  const imageMsg = {
    key: { remoteJid: "test@s.whatsapp.net", id: "test-msg-1" },
    message: {
      imageMessage: {
        mimetype: "image/jpeg",
        fileLength: 1024,
      },
    },
  } as unknown as WAMessage;

  const imageInfo = extractMediaInfo(imageMsg);
  if (imageInfo?.type !== "image") {
    throw new Error("Image type detection failed");
  }

  // Test media type inference
  if (inferMediaType("photo.jpg") !== "image") {
    throw new Error("Image extension inference failed");
  }

  if (inferMediaType("video.mp4") !== "video") {
    throw new Error("Video extension inference failed");
  }

  // Test MIME type inference
  if (inferMimeType("photo.png", "image") !== "image/png") {
    throw new Error("PNG MIME type inference failed");
  }

  return {
    imageDetection: "ok",
    mediaTypeInference: "ok",
    mimeTypeInference: "ok",
  };
}

/**
 * Test WhatsApp adapter integration
 */
async function testAdapterIntegration(gatewayUrl: string): Promise<unknown> {
  const response = await fetch(`${gatewayUrl}/api/channels`, {
    signal: AbortSignal.timeout(5000),
  });

  const data = await response.json();
  const whatsappChannel = data.channels.find((c: { id: string }) => c.id === "whatsapp");

  if (!whatsappChannel) {
    return {
      available: false,
      note: "WhatsApp adapter not registered (may require credentials)",
    };
  }

  // Check if we have status information
  const hasStatus = whatsappChannel.status && typeof whatsappChannel.status === "object";

  return {
    available: true,
    hasStatus,
    connected: whatsappChannel.status?.connected ?? false,
    selfJid: whatsappChannel.status?.selfJid,
  };
}

/**
 * Run all WhatsApp tests
 */
export async function runWhatsAppTests(config: WhatsAppTesterConfig): Promise<WhatsAppTestSuite> {
  const timeoutMs = config.timeoutMs ?? 15000;
  const results: WhatsAppTestResult[] = [];

  const tests = [
    { name: "Channel Availability", fn: () => testChannelAvailability(config.gatewayUrl) },
    { name: "Configuration", fn: () => testWhatsAppConfiguration(config.gatewayUrl) },
    { name: "Message Normalization", fn: () => testMessageNormalization() },
    { name: "Mention Detection", fn: () => testMentionDetection() },
    { name: "Media Handling", fn: () => testMediaHandling() },
    { name: "Adapter Integration", fn: () => testAdapterIntegration(config.gatewayUrl) },
  ];

  for (const { name, fn } of tests) {
    config.logger?.debug({ test: name }, "Running WhatsApp test");
    const result = await runTest(name, fn, timeoutMs);
    results.push(result);
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  return {
    name: "WhatsApp Integration",
    results,
    passed,
    failed,
    skipped,
    total: results.length,
  };
}

/**
 * Format test results for display
 */
export function formatWhatsAppResults(suite: WhatsAppTestSuite): string {
  const lines: string[] = [];

  lines.push(`\n${suite.name}`);
  lines.push("=".repeat(suite.name.length));

  for (const result of suite.results) {
    const icon = result.status === "pass" ? "✓" : result.status === "skip" ? "○" : "✗";
    const statusText = result.status.toUpperCase().padEnd(6);
    lines.push(`${icon} ${statusText} ${result.test} (${result.durationMs}ms)`);

    if (result.error) {
      lines.push(`  Error: ${result.error}`);
    }

    if (result.details && typeof result.details === "object") {
      const details = result.details as Record<string, unknown>;
      for (const [key, value] of Object.entries(details)) {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  lines.push("");
  lines.push(`Results: ${suite.passed} passed, ${suite.failed} failed, ${suite.skipped} skipped`);

  return lines.join("\n");
}

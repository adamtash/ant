/**
 * WhatsApp Message Handler Unit Tests
 *
 * Tests the message processing logic in isolation.
 */

import { describe, it, expect } from "vitest";
import {
  extractTextFromMessage,
  extractMentions,
  hasKeywordMention,
  isGroupJid,
  isStatusJid,
  normalizeJid,
  extractSenderInfo,
  extractMediaInfo,
  inferMediaType,
  inferMimeType,
} from "../../../../src/channels/whatsapp/message-handler.js";
import type { WAMessage } from "@whiskeysockets/baileys";

describe("extractTextFromMessage", () => {
  it("should extract text from conversation message", () => {
    const msg = {
      message: {
        conversation: "Hello world",
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("Hello world");
  });

  it("should extract text from extended text message", () => {
    const msg = {
      message: {
        extendedTextMessage: {
          text: "Extended text",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("Extended text");
  });

  it("should extract caption from image message", () => {
    const msg = {
      message: {
        imageMessage: {
          caption: "Image caption",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("Image caption");
  });

  it("should extract caption from video message", () => {
    const msg = {
      message: {
        videoMessage: {
          caption: "Video caption",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("Video caption");
  });

  it("should return null for audio messages", () => {
    const msg = {
      message: {
        audioMessage: {
          mimetype: "audio/ogg",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("[Audio message]");
  });

  it("should return null for sticker messages", () => {
    const msg = {
      message: {
        stickerMessage: {
          mimetype: "image/webp",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("[Sticker]");
  });

  it("should extract contact info", () => {
    const msg = {
      message: {
        contactMessage: {
          displayName: "John Doe",
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("[Contact: John Doe]");
  });

  it("should extract location info", () => {
    const msg = {
      message: {
        locationMessage: {
          degreesLatitude: 40.7128,
          degreesLongitude: -74.006,
        },
      },
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBe("[Location: 40.7128, -74.006]");
  });

  it("should return null for messages without text", () => {
    const msg = {
      message: {},
    } as WAMessage;

    expect(extractTextFromMessage(msg)).toBeNull();
  });

  it("should return null for null message", () => {
    expect(extractTextFromMessage(null as unknown as WAMessage)).toBeNull();
  });
});

describe("extractMentions", () => {
  it("should extract mentioned JIDs", () => {
    const msg = {
      message: {
        extendedTextMessage: {
          text: "Hello @user1 and @user2",
          contextInfo: {
            mentionedJid: ["user1@s.whatsapp.net", "user2@s.whatsapp.net"],
          },
        },
      },
    } as WAMessage;

    expect(extractMentions(msg)).toEqual(["user1@s.whatsapp.net", "user2@s.whatsapp.net"]);
  });

  it("should return empty array for no mentions", () => {
    const msg = {
      message: {
        conversation: "Hello world",
      },
    } as WAMessage;

    expect(extractMentions(msg)).toEqual([]);
  });
});

describe("hasKeywordMention", () => {
  it("should detect keyword in text", () => {
    expect(hasKeywordMention("Hello bot", ["bot", "assistant"])).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(hasKeywordMention("Hello BOT", ["bot"])).toBe(true);
  });

  it("should return false if no keywords match", () => {
    expect(hasKeywordMention("Hello world", ["bot", "assistant"])).toBe(false);
  });

  it("should return false for empty keywords", () => {
    expect(hasKeywordMention("Hello bot", [])).toBe(false);
  });

  it("should handle partial matches", () => {
    expect(hasKeywordMention("This is about robots", ["bot"])).toBe(true);
  });
});

describe("isGroupJid", () => {
  it("should identify group JIDs", () => {
    expect(isGroupJid("1234567890@g.us")).toBe(true);
  });

  it("should identify non-group JIDs", () => {
    expect(isGroupJid("1234567890@s.whatsapp.net")).toBe(false);
  });

  it("should handle null/undefined", () => {
    expect(isGroupJid(null as unknown as string)).toBe(false);
    expect(isGroupJid(undefined as unknown as string)).toBe(false);
  });

  it("should handle broadcast JIDs", () => {
    expect(isGroupJid("1234567890@broadcast")).toBe(false);
  });
});

describe("isStatusJid", () => {
  it("should identify status broadcast", () => {
    expect(isStatusJid("status@broadcast")).toBe(true);
  });

  it("should identify non-status JIDs", () => {
    expect(isStatusJid("1234567890@s.whatsapp.net")).toBe(false);
  });

  it("should handle null/undefined", () => {
    expect(isStatusJid(null as unknown as string)).toBe(false);
  });
});

describe("normalizeJid", () => {
  it("should normalize JID to lowercase", () => {
    expect(normalizeJid("USER@S.WHATSAPP.NET")).toBe("user@s.whatsapp.net");
  });

  it("should trim whitespace", () => {
    expect(normalizeJid("  user@s.whatsapp.net  ")).toBe("user@s.whatsapp.net");
  });

  it("should handle undefined", () => {
    expect(normalizeJid(undefined)).toBe("");
  });
});

describe("extractSenderInfo", () => {
  it("should extract sender from direct message", () => {
    const msg = {
      key: {
        remoteJid: "sender@s.whatsapp.net",
        fromMe: false,
      },
      pushName: "Sender Name",
    } as WAMessage;

    expect(extractSenderInfo(msg)).toEqual({
      id: "sender@s.whatsapp.net",
      name: "Sender Name",
      isFromMe: false,
    });
  });

  it("should extract participant from group message", () => {
    const msg = {
      key: {
        remoteJid: "group@g.us",
        participant: "participant@s.whatsapp.net",
        fromMe: false,
      },
      pushName: "Participant Name",
    } as WAMessage;

    expect(extractSenderInfo(msg)).toEqual({
      id: "participant@s.whatsapp.net",
      name: "Participant Name",
      isFromMe: false,
    });
  });

  it("should identify fromMe messages", () => {
    const msg = {
      key: {
        remoteJid: "user@s.whatsapp.net",
        fromMe: true,
      },
    } as WAMessage;

    expect(extractSenderInfo(msg).isFromMe).toBe(true);
  });
});

describe("extractMediaInfo", () => {
  it("should extract image info", () => {
    const msg = {
      message: {
        imageMessage: {
          mimetype: "image/jpeg",
          fileLength: "1024",
        },
      },
    } as WAMessage;

    const mediaInfo = extractMediaInfo(msg);
    expect(mediaInfo).toEqual({
      type: "image",
      mimeType: "image/jpeg",
      fileLength: 1024,
      mediaKey: undefined,
      url: undefined,
    });
  });

  it("should extract video info", () => {
    const msg = {
      message: {
        videoMessage: {
          mimetype: "video/mp4",
        },
      },
    } as WAMessage;

    const mediaInfo = extractMediaInfo(msg);
    expect(mediaInfo?.type).toBe("video");
    expect(mediaInfo?.mimeType).toBe("video/mp4");
  });

  it("should extract audio info", () => {
    const msg = {
      message: {
        audioMessage: {
          mimetype: "audio/ogg",
        },
      },
    } as WAMessage;

    const mediaInfo = extractMediaInfo(msg);
    expect(mediaInfo?.type).toBe("audio");
  });

  it("should extract document info", () => {
    const msg = {
      message: {
        documentMessage: {
          mimetype: "application/pdf",
          fileName: "document.pdf",
        },
      },
    } as WAMessage;

    const mediaInfo = extractMediaInfo(msg);
    expect(mediaInfo?.type).toBe("file");
    expect(mediaInfo?.filename).toBe("document.pdf");
  });

  it("should return null for text messages", () => {
    const msg = {
      message: {
        conversation: "Hello",
      },
    } as WAMessage;

    expect(extractMediaInfo(msg)).toBeNull();
  });
});

describe("inferMediaType", () => {
  it("should identify images", () => {
    expect(inferMediaType("photo.jpg")).toBe("image");
    expect(inferMediaType("photo.png")).toBe("image");
    expect(inferMediaType("photo.jpeg")).toBe("image");
    expect(inferMediaType("photo.gif")).toBe("image");
    expect(inferMediaType("photo.webp")).toBe("image");
  });

  it("should identify videos", () => {
    expect(inferMediaType("video.mp4")).toBe("video");
    expect(inferMediaType("video.mov")).toBe("video");
    expect(inferMediaType("video.webm")).toBe("video");
  });

  it("should default to document for unknown types", () => {
    expect(inferMediaType("file.pdf")).toBe("document");
    expect(inferMediaType("file.txt")).toBe("document");
  });
});

describe("inferMimeType", () => {
  it("should infer image MIME types", () => {
    expect(inferMimeType("photo.png", "image")).toBe("image/png");
    expect(inferMimeType("photo.jpg", "image")).toBe("image/jpeg");
    expect(inferMimeType("photo.jpeg", "image")).toBe("image/jpeg");
  });

  it("should infer video MIME types", () => {
    expect(inferMimeType("video.mp4", "video")).toBe("video/mp4");
    expect(inferMimeType("video.mov", "video")).toBe("video/quicktime");
  });

  it("should return undefined for documents", () => {
    expect(inferMimeType("file.pdf", "document")).toBeUndefined();
  });
});

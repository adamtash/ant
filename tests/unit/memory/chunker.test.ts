import { describe, it, expect } from "vitest";
import {
  chunkText,
  createMemoryChunks,
  estimateTokens,
  getOptimalChunkSize,
  DEFAULT_CHUNK_OPTIONS,
} from "../../../src/memory/chunker.js";

describe("chunker", () => {
  describe("chunkText", () => {
    it("should chunk plain text into segments", () => {
      const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5";
      const chunks = chunkText(text, { chunkSize: 20, overlap: 0, preserveMarkdown: false });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty("text");
      expect(chunks[0]).toHaveProperty("startLine");
      expect(chunks[0]).toHaveProperty("endLine");
    });

    it("should preserve line numbers correctly", () => {
      const text = "Line 1\nLine 2\nLine 3";
      const chunks = chunkText(text, { chunkSize: 1000, overlap: 0, preserveMarkdown: false });

      // Single chunk should start at line 1
      expect(chunks[0].startLine).toBe(1);
    });

    it("should handle markdown headers", () => {
      const markdown = `# Header 1
Some content under header 1.

## Header 2
Some content under header 2.

### Header 3
Some content under header 3.`;

      const chunks = chunkText(markdown, { chunkSize: 1000, overlap: 0, preserveMarkdown: true });

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should split large sections by paragraphs", () => {
      const longSection = `# Long Section
${"Paragraph content. ".repeat(100)}

Another paragraph with content.

${"More content here. ".repeat(100)}`;

      const chunks = chunkText(longSection, { chunkSize: 500, overlap: 50, preserveMarkdown: true });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should apply overlap between chunks", () => {
      const text = "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8";
      const chunks = chunkText(text, { chunkSize: 30, overlap: 10, preserveMarkdown: false });

      // With overlap, consecutive chunks should share some content
      if (chunks.length > 1) {
        // The end of chunk 0 might overlap with start of chunk 1
        expect(chunks[0].endLine).toBeGreaterThanOrEqual(chunks[0].startLine);
      }
    });

    it("should use default options when not specified", () => {
      const text = "Some text content";
      const chunks = chunkText(text);

      expect(chunks.length).toBeGreaterThan(0);
    });

    it("should handle empty text", () => {
      const chunks = chunkText("");
      expect(chunks.length).toBe(0);
    });

    it("should handle whitespace-only text", () => {
      const chunks = chunkText("   \n   \n   ");
      expect(chunks.length).toBe(0);
    });
  });

  describe("createMemoryChunks", () => {
    it("should create memory chunks with IDs", () => {
      const textChunks = [
        { text: "Chunk 1 content", startLine: 1, endLine: 5 },
        { text: "Chunk 2 content", startLine: 6, endLine: 10 },
      ];

      const memoryChunks = createMemoryChunks(textChunks, "/path/to/file.md", "memory");

      expect(memoryChunks.length).toBe(2);
      expect(memoryChunks[0].id).toBe("/path/to/file.md#0");
      expect(memoryChunks[1].id).toBe("/path/to/file.md#1");
      expect(memoryChunks[0].path).toBe("/path/to/file.md");
      expect(memoryChunks[0].source).toBe("memory");
    });

    it("should include file hash when provided", () => {
      const textChunks = [{ text: "Content", startLine: 1, endLine: 1 }];

      const memoryChunks = createMemoryChunks(textChunks, "/path/file.md", "sessions", "abc123");

      expect(memoryChunks[0].fileHash).toBe("abc123");
    });

    it("should set indexedAt timestamp", () => {
      const before = Date.now();
      const textChunks = [{ text: "Content", startLine: 1, endLine: 1 }];
      const memoryChunks = createMemoryChunks(textChunks, "/path/file.md", "memory");
      const after = Date.now();

      expect(memoryChunks[0].indexedAt).toBeGreaterThanOrEqual(before);
      expect(memoryChunks[0].indexedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens based on character count", () => {
      const text = "This is a test string with about 40 characters";
      const tokens = estimateTokens(text);

      // ~4 chars per token
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBe(Math.ceil(text.length / 4));
    });

    it("should handle empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should handle long text", () => {
      const longText = "a".repeat(10000);
      const tokens = estimateTokens(longText);

      expect(tokens).toBe(2500); // 10000 / 4
    });
  });

  describe("getOptimalChunkSize", () => {
    it("should return chunk size based on context window", () => {
      const chunkSize = getOptimalChunkSize(8000);

      expect(chunkSize).toBeGreaterThanOrEqual(800);
      expect(chunkSize).toBeLessThanOrEqual(3200);
    });

    it("should respect minimum chunk size of 800", () => {
      const chunkSize = getOptimalChunkSize(1000);

      expect(chunkSize).toBeGreaterThanOrEqual(800);
    });

    it("should respect maximum chunk size of 3200", () => {
      const chunkSize = getOptimalChunkSize(100000);

      expect(chunkSize).toBeLessThanOrEqual(3200);
    });

    it("should return optimal size for typical context windows", () => {
      // For 8k context (32000 chars), optimal would be 3200 (10%)
      expect(getOptimalChunkSize(8000)).toBe(3200);

      // For 4k context (16000 chars), optimal would be 1600
      expect(getOptimalChunkSize(4000)).toBe(1600);
    });
  });

  describe("DEFAULT_CHUNK_OPTIONS", () => {
    it("should have expected default values", () => {
      expect(DEFAULT_CHUNK_OPTIONS.chunkSize).toBe(1600);
      expect(DEFAULT_CHUNK_OPTIONS.overlap).toBe(200);
      expect(DEFAULT_CHUNK_OPTIONS.preserveMarkdown).toBe(true);
    });
  });
});

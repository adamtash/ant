/**
 * Text Chunking for Embeddings
 * Phase 7: Memory System Redesign
 *
 * Splits documents into overlapping chunks suitable for embedding.
 * Preserves markdown structure when possible.
 */

import type { ChunkOptions, MemoryChunk } from "./types.js";

/**
 * Default chunking options
 */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 1600,
  overlap: 200,
  preserveMarkdown: true,
};

/**
 * Chunk text into overlapping segments
 */
export function chunkText(
  text: string,
  options: Partial<ChunkOptions> = {},
): Array<{ text: string; startLine: number; endLine: number }> {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };

  if (opts.preserveMarkdown) {
    return chunkMarkdown(text, opts.chunkSize, opts.overlap);
  }

  return chunkPlain(text, opts.chunkSize, opts.overlap);
}

/**
 * Chunk plain text by character count with line tracking
 */
function chunkPlain(
  text: string,
  chunkSize: number,
  overlap: number,
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = text.split("\n");
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  let buffer: string[] = [];
  let startLine = 1;
  let charCount = 0;

  const flush = (endLine: number) => {
    if (buffer.length === 0) return;
    const chunkText = buffer.join("\n");
    if (chunkText.trim()) {
      chunks.push({ text: chunkText, startLine, endLine });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    buffer.push(line);
    charCount += line.length + 1;

    if (charCount >= chunkSize) {
      flush(i + 1);

      // Calculate overlap in lines
      const overlapLines =
        overlap > 0 ? Math.ceil((overlap / chunkSize) * buffer.length) : 0;
      const keepLines = buffer.slice(Math.max(0, buffer.length - overlapLines));

      buffer = keepLines;
      startLine = Math.max(1, i + 2 - keepLines.length);
      charCount = keepLines.join("\n").length;
    }
  }

  flush(lines.length);
  return chunks;
}

/**
 * Chunk markdown text preserving structure
 *
 * Strategy:
 * 1. Split by headers (h1-h4)
 * 2. If sections are too large, split by paragraphs
 * 3. If still too large, fall back to character-based splitting
 */
function chunkMarkdown(
  text: string,
  chunkSize: number,
  overlap: number,
): Array<{ text: string; startLine: number; endLine: number }> {
  const lines = text.split("\n");
  const sections = splitByHeaders(lines);
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];

  for (const section of sections) {
    const sectionText = section.lines.join("\n");

    if (sectionText.length <= chunkSize) {
      // Section fits in one chunk
      if (sectionText.trim()) {
        chunks.push({
          text: sectionText,
          startLine: section.startLine,
          endLine: section.endLine,
        });
      }
    } else {
      // Section too large, split by paragraphs
      const paragraphChunks = splitByParagraphs(
        section.lines,
        section.startLine,
        chunkSize,
        overlap,
      );

      if (paragraphChunks.length > 0) {
        chunks.push(...paragraphChunks);
      } else {
        // Fall back to plain chunking
        const plainChunks = chunkPlain(sectionText, chunkSize, overlap);
        for (const chunk of plainChunks) {
          chunks.push({
            text: chunk.text,
            startLine: section.startLine + chunk.startLine - 1,
            endLine: section.startLine + chunk.endLine - 1,
          });
        }
      }
    }
  }

  // Add overlap between sections if needed
  return addSectionOverlap(chunks, overlap, text);
}

/**
 * Split lines by markdown headers
 */
function splitByHeaders(
  lines: string[],
): Array<{ lines: string[]; startLine: number; endLine: number }> {
  const sections: Array<{ lines: string[]; startLine: number; endLine: number }> = [];
  let currentLines: string[] = [];
  let currentStart = 1;

  const headerPattern = /^#{1,4}\s+/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    if (headerPattern.test(line) && currentLines.length > 0) {
      // Flush current section
      sections.push({
        lines: currentLines,
        startLine: currentStart,
        endLine: i,
      });
      currentLines = [line];
      currentStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  // Flush remaining
  if (currentLines.length > 0) {
    sections.push({
      lines: currentLines,
      startLine: currentStart,
      endLine: lines.length,
    });
  }

  return sections;
}

/**
 * Split section by paragraphs (double newlines)
 */
function splitByParagraphs(
  lines: string[],
  baseStartLine: number,
  chunkSize: number,
  overlap: number,
): Array<{ text: string; startLine: number; endLine: number }> {
  const chunks: Array<{ text: string; startLine: number; endLine: number }> = [];
  let buffer: string[] = [];
  let startLine = baseStartLine;
  let charCount = 0;
  let inBlankRun = false;

  const flush = (endLine: number) => {
    if (buffer.length === 0) return;
    const chunkText = buffer.join("\n");
    if (chunkText.trim()) {
      chunks.push({ text: chunkText, startLine, endLine });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const isBlank = line.trim() === "";

    if (isBlank && inBlankRun) {
      // Double blank = paragraph break
      if (charCount >= chunkSize * 0.5) {
        // Only break if we have meaningful content
        flush(baseStartLine + i);

        // Keep some overlap
        const overlapLines =
          overlap > 0 ? Math.ceil((overlap / chunkSize) * buffer.length) : 0;
        const keepLines = buffer.slice(Math.max(0, buffer.length - overlapLines));

        buffer = keepLines;
        startLine = baseStartLine + i + 1 - keepLines.length;
        charCount = keepLines.join("\n").length;
      }
    }

    buffer.push(line);
    charCount += line.length + 1;
    inBlankRun = isBlank;

    if (charCount >= chunkSize) {
      flush(baseStartLine + i);

      const overlapLines =
        overlap > 0 ? Math.ceil((overlap / chunkSize) * buffer.length) : 0;
      const keepLines = buffer.slice(Math.max(0, buffer.length - overlapLines));

      buffer = keepLines;
      startLine = baseStartLine + i + 1 - keepLines.length;
      charCount = keepLines.join("\n").length;
    }
  }

  flush(baseStartLine + lines.length - 1);
  return chunks;
}

/**
 * Add overlap context between sections
 */
function addSectionOverlap(
  chunks: Array<{ text: string; startLine: number; endLine: number }>,
  overlap: number,
  _originalText: string,
): Array<{ text: string; startLine: number; endLine: number }> {
  // For now, we rely on the within-section overlap
  // Cross-section overlap could be added here if needed
  return chunks;
}

/**
 * Create memory chunks with IDs from chunked text
 */
export function createMemoryChunks(
  textChunks: Array<{ text: string; startLine: number; endLine: number }>,
  path: string,
  source: "memory" | "sessions",
  fileHash?: string,
): MemoryChunk[] {
  const now = Date.now();

  return textChunks.map((chunk, index) => ({
    id: `${path}#${index}`,
    path,
    source,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
    indexedAt: now,
    fileHash,
  }));
}

/**
 * Estimate token count from text (rough approximation)
 * Uses ~4 chars per token as a heuristic
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Get optimal chunk size for a given context window
 */
export function getOptimalChunkSize(contextWindow: number): number {
  // Aim for chunks that are ~1/10 of context window
  // with a floor of 800 and ceiling of 3200
  const optimal = Math.floor((contextWindow * 4) / 10);
  return Math.max(800, Math.min(3200, optimal));
}

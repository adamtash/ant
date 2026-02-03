import crypto from "node:crypto";

import type { ToolCall } from "./types.js";

export type ToolCallParseResult =
  | {
      ok: true;
      toolCalls: ToolCall[];
      cleanedContent: string;
      hadMarkup: true;
      truncated: boolean;
    }
  | {
      ok: false;
      error: string;
      hadMarkup: boolean;
      truncated: boolean;
    };

const TOOL_CALL_TAG_RE = /<tool_call\b[^>]*>/i;
const TOOL_CALL_END_TAG_RE = /<\/tool_call>/i;
const TOOL_CALL_JSON_HINT_RE = /"tool_calls"\s*:|"toolCalls"\s*:/;

export function looksLikeToolCallMarkup(text: string): boolean {
  return TOOL_CALL_TAG_RE.test(text) || TOOL_CALL_JSON_HINT_RE.test(text);
}

export function parseToolCallsFromText(text: string): ToolCallParseResult {
  const raw = text ?? "";
  const trimmed = raw.trim();
  const hadMarkup = looksLikeToolCallMarkup(trimmed);

  const jsonResult = parseJsonToolCalls(trimmed);
  if (jsonResult) return { ...jsonResult, hadMarkup: true };

  const xmlResult = parseXmlToolCalls(trimmed);
  if (xmlResult) return { ...xmlResult, hadMarkup: true };

  const truncated = TOOL_CALL_TAG_RE.test(trimmed) && !TOOL_CALL_END_TAG_RE.test(trimmed);
  return {
    ok: false,
    error: hadMarkup ? "tool_call_parse_failed" : "no_tool_call_markup",
    hadMarkup,
    truncated,
  };
}

function parseJsonToolCalls(text: string): Omit<ToolCallParseResult & { ok: true }, "hadMarkup"> | null {
  const candidates: string[] = [];

  if (text.startsWith("{") || text.startsWith("[")) {
    candidates.push(text);
  }

  const fenced = extractFencedJson(text);
  if (fenced) candidates.push(fenced);

  const embedded = extractEmbeddedJsonObject(text);
  if (embedded) candidates.push(embedded);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const toolCalls = coerceToolCallsFromUnknown(parsed);
      if (toolCalls.length === 0) continue;
      return {
        ok: true,
        toolCalls,
        cleanedContent: stripCandidateFromText(text, candidate).trim(),
        truncated: false,
      };
    } catch {
      // continue
    }
  }

  return null;
}

function extractFencedJson(text: string): string | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const block = m?.[1]?.trim();
  return block ? block : null;
}

function extractEmbeddedJsonObject(text: string): string | null {
  const idx = text.search(TOOL_CALL_JSON_HINT_RE);
  if (idx === -1) return null;

  const before = text.lastIndexOf("{", idx);
  if (before === -1) return null;

  const after = text.lastIndexOf("}");
  if (after === -1 || after <= before) return null;

  const candidate = text.slice(before, after + 1).trim();
  return candidate.startsWith("{") && candidate.endsWith("}") ? candidate : null;
}

function stripCandidateFromText(text: string, candidate: string): string {
  const idx = text.indexOf(candidate);
  if (idx === -1) return text;
  return (text.slice(0, idx) + text.slice(idx + candidate.length)).trim();
}

function coerceToolCallsFromUnknown(value: unknown): ToolCall[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => coerceToolCallsFromUnknown(item));
  }

  if (!value || typeof value !== "object") return [];

  const obj = value as Record<string, unknown>;
  const toolCalls =
    Array.isArray(obj.toolCalls) ? obj.toolCalls : Array.isArray(obj.tool_calls) ? obj.tool_calls : null;

  if (toolCalls) {
    return toolCalls
      .map((item, idx) => coerceSingleToolCall(item, idx))
      .filter((item): item is ToolCall => Boolean(item));
  }

  if (typeof obj.name === "string" && obj.name.trim()) {
    const args = obj.arguments && typeof obj.arguments === "object" ? (obj.arguments as Record<string, unknown>) : {};
    return [
      {
        id: typeof obj.id === "string" && obj.id.trim() ? obj.id : `parsed-${crypto.randomUUID()}`,
        name: obj.name.trim(),
        arguments: args,
      },
    ];
  }

  return [];
}

function coerceSingleToolCall(value: unknown, idx: number): ToolCall | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;

  const nameRaw = obj.name ?? (obj.function && typeof obj.function === "object" ? (obj.function as any).name : undefined);
  if (typeof nameRaw !== "string" || !nameRaw.trim()) return null;

  const argsRaw =
    obj.arguments ??
    (obj.function && typeof obj.function === "object" ? (obj.function as any).arguments : undefined);

  const args = coerceArguments(argsRaw);
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id : `parsed-${idx + 1}`;

  return { id, name: nameRaw.trim(), arguments: args };
}

function coerceArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};

  const trimmed = value.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  return {};
}

function parseXmlToolCalls(text: string): Omit<ToolCallParseResult & { ok: true }, "hadMarkup"> | null {
  if (!TOOL_CALL_TAG_RE.test(text)) return null;
  if (!TOOL_CALL_END_TAG_RE.test(text)) return null;

  const calls: ToolCall[] = [];
  const cleanedParts: string[] = [];

  let cursor = 0;
  while (true) {
    const start = text.slice(cursor).search(TOOL_CALL_TAG_RE);
    if (start === -1) {
      cleanedParts.push(text.slice(cursor));
      break;
    }
    const startIdx = cursor + start;
    const openEnd = text.indexOf(">", startIdx);
    if (openEnd === -1) return null;

    const endIdx = text.indexOf("</tool_call>", openEnd);
    if (endIdx === -1) return null;

    cleanedParts.push(text.slice(cursor, startIdx));

    const inner = text.slice(openEnd + 1, endIdx);
    const toolCall = coerceXmlToolCall(inner, calls.length);
    if (toolCall) calls.push(toolCall);

    cursor = endIdx + "</tool_call>".length;
  }

  if (calls.length === 0) return null;

  return {
    ok: true,
    toolCalls: calls,
    cleanedContent: cleanedParts.join("").trim(),
    truncated: false,
  };
}

function coerceXmlToolCall(inner: string, idx: number): ToolCall | null {
  const body = inner.trim();
  if (!body) return null;

  const toolName = body.split("<", 1)[0]?.trim();
  if (!toolName) return null;

  const args: Record<string, unknown> = {};

  const pairRe = /<arg_key>([\s\S]*?)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
  for (const match of body.matchAll(pairRe)) {
    const key = (match[1] ?? "").trim();
    if (!key) continue;
    const rawValue = (match[2] ?? "").trim();
    args[key] = coerceXmlArgValue(rawValue);
  }

  return {
    id: `parsed-xml-${idx + 1}`,
    name: toolName,
    arguments: args,
  };
}

function coerceXmlArgValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^(?:true|false|null)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true"
      ? true
      : trimmed.toLowerCase() === "false"
        ? false
        : null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // ignore
    }
  }
  return trimmed;
}


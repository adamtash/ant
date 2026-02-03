import type { MemoryCategory, MemorySource } from "./types.js";

export type CategorizeMemoryParams = {
  text: string;
  source?: MemorySource;
  path?: string;
};

export type CategorizedMemory = {
  category: MemoryCategory;
  priority: number; // 1-10
  cleanedText?: string;
};

const CATEGORY_VALUES: MemoryCategory[] = [
  "critical",
  "important",
  "contextual",
  "ephemeral",
  "diagnostic",
];

const CATEGORY_LINE_RE = new RegExp(
  String.raw`^\s*\[(?<category>${CATEGORY_VALUES.join("|")})(?::(?<priority>\d{1,2}))?\]\s*$`,
  "i"
);

const CATEGORY_PREFIX_RE = new RegExp(
  String.raw`^\s*(?<category>${CATEGORY_VALUES.join("|")})(?::(?<priority>\d{1,2}))?\s*:\s*(?<rest>[\s\S]+)$`,
  "i"
);

const CATEGORY_BOLD_RE = new RegExp(
  String.raw`^\s*[-*]?\s*\\[[^\\]]+\\]\\s*\\*\\*(?<category>${CATEGORY_VALUES.join("|")})\\*\\*\\s*:\\s*(?<rest>[\s\S]+)$`,
  "i"
);

const USER_PREF_RE = /\b(user|owner)\b[\s\S]{0,30}\b(prefers|always|never|default|set to)\b/i;
const SECRET_RE = /\b(api[_ -]?key|secret|token|password|private key|ssh key)\b/i;
const DIAGNOSTIC_RE = /\b(error|exception|failed|traceback|stack trace|panic|segfault|timeout)\b/i;
const SOLUTION_RE = /\b(fixed|solved|resolved|workaround|root cause|mitigation)\b/i;
const EPHEMERAL_RE = /\b(todo|temporary|temp|scratch|debug note|ignore this)\b/i;

export function categorizeMemoryText(params: CategorizeMemoryParams): CategorizedMemory {
  const raw = params.text ?? "";
  const trimmed = raw.trim();
  if (!trimmed) {
    return { category: "ephemeral", priority: 1 };
  }

  const firstLine = trimmed.split("\n", 1)[0] ?? "";
  const bold = firstLine.match(CATEGORY_BOLD_RE);
  if (bold?.groups?.category && bold?.groups?.rest) {
    const category = normalizeCategory(bold.groups.category);
    if (category) {
      const priority = defaultPriority(category);
      return { category, priority, cleanedText: bold.groups.rest.trim() };
    }
  }

  const header = firstLine.match(CATEGORY_LINE_RE);
  if (header?.groups?.category) {
    const category = normalizeCategory(header.groups.category);
    if (category) {
      const priority = normalizePriority(header.groups.priority, category);
      const rest = trimmed.split("\n").slice(1).join("\n").trim();
      return { category, priority, cleanedText: rest || undefined };
    }
  }

  const prefix = trimmed.match(CATEGORY_PREFIX_RE);
  if (prefix?.groups?.category && prefix?.groups?.rest) {
    const category = normalizeCategory(prefix.groups.category);
    if (category) {
      const priority = normalizePriority(prefix.groups.priority, category);
      return { category, priority, cleanedText: prefix.groups.rest.trim() };
    }
  }

  // Heuristic fallback
  const category = inferCategory(trimmed);
  const priority = defaultPriority(category);

  // Session transcripts tend to be contextual unless clearly otherwise.
  if (params.source === "sessions" && category === "important") {
    return { category: "contextual", priority: 5 };
  }

  return { category, priority };
}

function inferCategory(text: string): MemoryCategory {
  if (USER_PREF_RE.test(text) || SECRET_RE.test(text)) return "critical";
  if (DIAGNOSTIC_RE.test(text)) return "diagnostic";
  if (SOLUTION_RE.test(text)) return "important";
  if (EPHEMERAL_RE.test(text)) return "ephemeral";
  return "contextual";
}

function normalizeCategory(value: string | undefined): MemoryCategory | null {
  if (!value) return null;
  const lowered = value.trim().toLowerCase();
  return CATEGORY_VALUES.includes(lowered as MemoryCategory) ? (lowered as MemoryCategory) : null;
}

function defaultPriority(category: MemoryCategory): number {
  switch (category) {
    case "critical":
      return 10;
    case "important":
      return 8;
    case "contextual":
      return 5;
    case "diagnostic":
      return 4;
    case "ephemeral":
      return 2;
  }
}

function normalizePriority(raw: string | undefined, category: MemoryCategory): number {
  if (!raw) return defaultPriority(category);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultPriority(category);
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

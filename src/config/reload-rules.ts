import type { AntConfig } from "../config.js";

export type ReloadKind = "hot" | "restart" | "none";

export type ReloadAction =
  | "reload-routing"
  | "reload-agent"
  | "reload-memory-query"
  | "reload-tool-policies";

export type ReloadRule = {
  prefix: string;
  kind: ReloadKind;
  actions?: ReloadAction[];
};

export type ReloadPlan = {
  changedPaths: string[];
  hotPaths: string[];
  restartPaths: string[];
  noopPaths: string[];
  actions: ReloadAction[];
  requiresRestart: boolean;
  summary: string;
};

export const DEFAULT_RELOAD_RULES: ReloadRule[] = [
  // Hot-reloadable
  { prefix: "routing", kind: "hot", actions: ["reload-routing"] },
  { prefix: "agent.thinking", kind: "hot", actions: ["reload-agent"] },
  { prefix: "agent.toolLoop", kind: "hot", actions: ["reload-agent"] },
  { prefix: "agent.compaction", kind: "hot", actions: ["reload-agent"] },
  { prefix: "agent.maxToolIterations", kind: "hot", actions: ["reload-agent"] },
  { prefix: "agent.temperature", kind: "hot", actions: ["reload-agent"] },
  { prefix: "agent.maxHistoryTokens", kind: "hot", actions: ["reload-agent"] },
  { prefix: "memory.query", kind: "hot", actions: ["reload-memory-query"] },
  { prefix: "toolPolicies", kind: "hot", actions: ["reload-tool-policies"] },

  // Restart-required
  { prefix: "providers", kind: "restart" },
  { prefix: "gateway", kind: "restart" },
  { prefix: "ui", kind: "restart" },
  { prefix: "whatsapp", kind: "restart" },
  { prefix: "browser", kind: "restart" },
  { prefix: "workspaceDir", kind: "restart" },
  { prefix: "stateDir", kind: "restart" },
  { prefix: "runtime", kind: "restart" },
  { prefix: "cliTools", kind: "restart" },
  { prefix: "scheduler", kind: "restart" },
  { prefix: "monitoring", kind: "restart" },
  { prefix: "queue", kind: "restart" },
  { prefix: "logging", kind: "restart" },
];

export function stripResolved<T extends { resolved?: unknown }>(cfg: T): Omit<T, "resolved"> {
  const cloned: Record<string, unknown> = { ...(cfg as Record<string, unknown>) };
  delete cloned.resolved;
  return cloned as Omit<T, "resolved">;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === Object.prototype;
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  );
}

export function diffConfigPaths(prev: unknown, next: unknown, prefix = ""): string[] {
  if (Object.is(prev, next)) return [];

  if (isPrimitive(prev) || isPrimitive(next)) {
    return prefix ? [prefix] : ["<root>"];
  }

  if (Array.isArray(prev) || Array.isArray(next)) {
    return prefix ? [prefix] : ["<root>"];
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const changed: string[] = [];
    for (const key of keys) {
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      changed.push(...diffConfigPaths(prev[key], next[key], childPrefix));
    }
    return changed;
  }

  // Fallback for non-plain objects (dates, maps, etc.)
  return prefix ? [prefix] : ["<root>"];
}

function classifyPath(path: string, rules: ReloadRule[]): ReloadRule | null {
  if (!path) return null;
  // Most-specific prefix wins
  const matches = rules
    .filter((rule) => path === rule.prefix || path.startsWith(`${rule.prefix}.`))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return matches[0] ?? null;
}

export function buildReloadPlan(changedPaths: string[], rules: ReloadRule[] = DEFAULT_RELOAD_RULES): ReloadPlan {
  const unique = Array.from(new Set(changedPaths.filter(Boolean))).sort();
  const hotPaths: string[] = [];
  const restartPaths: string[] = [];
  const noopPaths: string[] = [];
  const actions = new Set<ReloadAction>();

  for (const p of unique) {
    const rule = classifyPath(p, rules);
    if (!rule) {
      restartPaths.push(p);
      continue;
    }
    if (rule.kind === "none") {
      noopPaths.push(p);
      continue;
    }
    if (rule.kind === "restart") {
      restartPaths.push(p);
      continue;
    }
    hotPaths.push(p);
    for (const action of rule.actions ?? []) actions.add(action);
  }

  const requiresRestart = restartPaths.length > 0;
  const summaryParts: string[] = [];
  if (hotPaths.length > 0) summaryParts.push(`hot: ${hotPaths.slice(0, 6).join(", ")}${hotPaths.length > 6 ? "…" : ""}`);
  if (restartPaths.length > 0) summaryParts.push(`restart: ${restartPaths.slice(0, 6).join(", ")}${restartPaths.length > 6 ? "…" : ""}`);
  if (noopPaths.length > 0) summaryParts.push(`noop: ${noopPaths.slice(0, 6).join(", ")}${noopPaths.length > 6 ? "…" : ""}`);

  return {
    changedPaths: unique,
    hotPaths,
    restartPaths,
    noopPaths,
    actions: Array.from(actions.values()).sort(),
    requiresRestart,
    summary: summaryParts.join(" | ") || "no changes",
  };
}

export function buildReloadPlanFromConfigs(prev: AntConfig, next: AntConfig): ReloadPlan {
  const prevRaw = stripResolved(prev);
  const nextRaw = stripResolved(next);
  const paths = diffConfigPaths(prevRaw, nextRaw).filter((p) => p !== "<root>");
  return buildReloadPlan(paths);
}


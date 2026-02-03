import type { MemoryCategory } from "./types.js";
import type { SqliteStore } from "./sqlite-store.js";

export function pruneMemory(params: {
  store: SqliteStore;
  targetTextBytes: number;
  preserveCategories?: MemoryCategory[];
}): { pruned: number; beforeTextBytes: number; afterTextBytes: number } {
  const preserve = params.preserveCategories?.length ? params.preserveCategories : undefined;
  return params.store.softPrune({
    targetTextBytes: params.targetTextBytes,
    preserveCategories: preserve,
  });
}


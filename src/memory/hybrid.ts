/**
 * Hybrid Search - Combines Vector and Keyword Search
 * 
 * Implements OpenClaw-style hybrid search that combines:
 * - Vector similarity search (semantic)
 * - FTS5 keyword search (exact matches)
 * 
 * Results are ranked by weighted combination of both scores.
 */

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  snippet: string;
  vectorScore: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: string;
  snippet: string;
  textScore: number;
};

export type HybridSearchResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: string;
};

/**
 * Build FTS5 query from raw user input
 * 
 * Converts user query into FTS5 AND syntax where all tokens must match.
 * Example: "machine learning" -> "\"machine\" AND \"learning\""
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  
  if (tokens.length === 0) {
    return null;
  }
  
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

/**
 * Convert BM25 rank to normalized score (0-1)
 * 
 * BM25 returns unbounded rank values, so we normalize to 0-1 range
 * where higher rank = lower score (database returns worst matches first)
 */
export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Merge hybrid search results with weighted scoring
 * 
 * Takes vector and keyword results, merges by ID, then re-ranks
 * using weighted combination: vectorWeight * vectorScore + textWeight * textScore
 */
export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
}): HybridSearchResult[] {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: string;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  // Add all vector results
  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  // Add/merge keyword results
  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      // Use better snippet if available
      if (r.snippet && r.snippet.length > existing.snippet.length) {
        existing.snippet = r.snippet;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  // Compute final scores and sort
  const merged = Array.from(byId.values())
    .map((entry) => {
      const score =
        params.vectorWeight * entry.vectorScore +
        params.textWeight * entry.textScore;
      
      return {
        id: entry.id,
        path: entry.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
        score,
        snippet: entry.snippet,
        source: entry.source,
      };
    })
    .sort((a, b) => b.score - a.score);

  return merged;
}

/**
 * Check if two strings are similar enough to be same snippet
 */
export function isSimilarSnippet(a: string, b: string, threshold = 0.8): boolean {
  if (a === b) return true;
  if (a.length === 0 || b.length === 0) return false;
  
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  
  // Simple overlap check
  const common = a
    .split(" ")
    .filter((word) => b.includes(word))
    .length;
  
  const commonRatio = common / Math.max(1, a.split(" ").length);
  return commonRatio >= threshold;
}

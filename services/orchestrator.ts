import { embedQuery } from "../lib/embedding";
import { performWebSearch, type SearchSource } from "./webSearch";
import { findSimilarCached } from "./vectorSearch";

export type SearchContext = {
  sources: SearchSource[];
  cached: boolean;
  embedding: number[];
};

/**
 * Orchestration layer — the core decision engine.
 *
 * Flow:
 *   1. Embed the user's query via Gemini
 *   2. Search the vector cache for a similar past query
 *   3. Cache HIT  → reuse the stored web search sources (skip Tavily)
 *      Cache MISS → call Tavily for fresh results
 *   4. Return sources + embedding (caller stores the result after streaming)
 *
 * The LLM always generates a fresh answer regardless of cache status,
 * only the *web search sources* are reused.
 */
export async function resolveSearchContext(
  query: string,
): Promise<SearchContext> {
  // ── 1. Embed the query ──────────────────────────────────────────────────
  const embedding = await embedQuery(query);

  // ── 2. Similarity search against the vector cache ───────────────────────
  const cached = await findSimilarCached(embedding);

  if (cached) {
    console.log(
      `[orchestrator] Cache HIT (similarity=${cached.similarity.toFixed(3)}) ` +
        `for "${query}" → reusing sources from "${cached.query}"`,
    );
    return {
      sources: cached.sources,
      cached: true,
      embedding,
    };
  }

  // ── 3. Cache MISS — call Tavily for fresh web search results ────────────
  console.log(`[orchestrator] Cache MISS for "${query}" → calling Tavily`);
  const searchPayload = await performWebSearch(query);

  return {
    sources: searchPayload.sources,
    cached: false,
    embedding,
  };
}

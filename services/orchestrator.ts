import { performWebSearch, type SearchSource } from "./webSearch";
import { findSimilarCached } from "./vectorSearch";

export type SearchContext = {
  sources: SearchSource[];
  images: string[];
  cached: boolean;
};

/**
 * Orchestration layer — the core decision engine.
 *
 * Flow:
 *   1. Search the vector cache for a similar past query (using the query
 *      embedding computed once by the caller — it's shared with memory recall)
 *   2. Cache HIT  → reuse the stored web search sources (skip Tavily)
 *      Cache MISS → call Tavily for fresh results
 *   3. Return sources (caller stores the result after streaming)
 *
 * The LLM always generates a fresh answer regardless of cache status,
 * only the *web search sources* are reused.
 */
export async function resolveSearchContext(
  query: string,
  embedding: number[],
): Promise<SearchContext> {
  // ── 1. Similarity search against the vector cache ───────────────────────
  if (embedding.length > 0) {
    const cached = await findSimilarCached(embedding);

    if (cached) {
      console.log(
        `[orchestrator] Cache HIT (similarity=${cached.similarity.toFixed(3)}) ` +
          `for "${query}" → reusing sources from "${cached.query}"`,
      );
      return {
        sources: cached.sources,
        images: [],
        cached: true,
      };
    }
  }

  // ── 2. Cache MISS — call Tavily for fresh web search results ────────────
  console.log(`[orchestrator] Cache MISS for "${query}" → calling Tavily`);
  const searchPayload = await performWebSearch(query);

  return {
    sources: searchPayload.sources,
    images: searchPayload.images,
    cached: false,
  };
}

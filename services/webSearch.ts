import { tavily } from "@tavily/core";

/**
 * A structured search result returned from our web search service.
 * Keeping this as a first-class type makes it easy to swap Tavily for
 * another provider, and gives vector-DB indexing a stable shape.
 */
export type SearchSource = {
  url: string;
  title: string;
  content: string;
  score: number;
};

export type WebSearchPayload = {
  query: string;
  rawResult: object;            // Full Tavily response – useful for future vector indexing
  sources: SearchSource[];
};

const client = tavily({ apiKey: process.env.TAVILY_API_KEY });

/**
 * Perform an advanced web search via Tavily.
 *
 * Design notes for future vector DB integration:
 *  - `rawResult` carries the full Tavily response so you can embed & store
 *    it without re-fetching.
 *  - `sources` is the normalised, cleaned up slice that the LLM prompt and
 *    the frontend need.
 *  - You can add a `checkCache(query)` call at the top of this function to
 *    short-circuit with a previously stored embedding match.
 */
export async function performWebSearch(query: string): Promise<WebSearchPayload> {
  const rawResult = await client.search(query, {
    searchDepth: "advanced",
    includeRawContent: false,   // flip to true when you want full page text for embeddings
    maxResults: 8,
  });

  const sources: SearchSource[] = rawResult.results.map((r) => ({
    url: r.url,
    title: r.title ?? "",
    content: r.content ?? "",
    score: r.score ?? 0,
  }));

  return { query, rawResult, sources };
}

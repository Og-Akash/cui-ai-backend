import { prisma } from "../lib/prisma";
import type { SearchSource } from "./webSearch";

const SIMILARITY_THRESHOLD = 0.88;
const CACHE_TTL_DAYS = 7;

type CacheHit = {
  id: string;
  query: string;
  sources: SearchSource[];
  llmResponse: string;
  similarity: number;
  createdAt: Date;
};

/**
 * Search the vector cache for a semantically similar query.
 *
 * Uses pgvector's `<=>` cosine distance operator. A cosine distance of 0
 * means identical; we convert to similarity (1 - distance) and filter
 * by SIMILARITY_THRESHOLD.
 *
 * Returns the best match or null if nothing is close enough.
 */
export async function findSimilarCached(
  embedding: number[],
): Promise<CacheHit | null> {
  const vectorStr = `[${embedding.join(",")}]`;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - CACHE_TTL_DAYS);

  // pgvector cosine distance: <=> returns a value between 0 (identical) and 2
  // similarity = 1 - distance  → 1 = identical, 0 = orthogonal
  const results = await prisma.$queryRaw<
    Array<{
      id: string;
      query: string;
      sources: unknown;
      llmResponse: string;
      similarity: number;
      createdAt: Date;
    }>
  >`
    SELECT
      id,
      query,
      sources,
      "llmResponse",
      1 - (embedding <=> ${vectorStr}::vector) AS similarity,
      "createdAt"
    FROM "SearchCache"
    WHERE "createdAt" > ${cutoffDate}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT 1
  `;

  if (!results.length) return null;

  const best = results[0]!;

  if (best.similarity < SIMILARITY_THRESHOLD) return null;

  return {
    id: best.id,
    query: best.query,
    sources: best.sources as SearchSource[],
    llmResponse: best.llmResponse,
    similarity: best.similarity,
    createdAt: best.createdAt,
  };
}

/**
 * Store a query + its web search results + the LLM answer in the
 * vector cache for future reuse.
 *
 * This is fire-and-forget — called after the response stream ends.
 */
export async function storeSearchResult(
  query: string,
  embedding: number[],
  sources: SearchSource[],
  llmResponse: string,
): Promise<void> {
  const vectorStr = `[${embedding.join(",")}]`;

  await prisma.$executeRaw`
    INSERT INTO "SearchCache" (id, query, embedding, sources, "llmResponse", "createdAt")
    VALUES (
      gen_random_uuid(),
      ${query},
      ${vectorStr}::vector,
      ${JSON.stringify(sources)}::jsonb,
      ${llmResponse},
      NOW()
    )
  `;
}

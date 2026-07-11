import { generateText } from "ai";
import { prisma } from "../lib/prisma";
import { google } from "../lib/models";
import { embedQuery } from "../lib/embedding";

/**
 * Long-term agent memory.
 *
 * Write path (fire-and-forget after each exchange): a small LLM pass reads
 * the exchange and extracts 0–3 durable facts about the *user* (identity,
 * preferences, ongoing projects). Each fact is embedded and stored unless a
 * near-duplicate (cosine similarity ≥ DEDUPE_THRESHOLD) already exists.
 *
 * Read path (at question time): the query embedding recalls the most similar
 * memories above RECALL_THRESHOLD, which get injected into the system prompt.
 */

const RECALL_THRESHOLD = 0.45;
const DEDUPE_THRESHOLD = 0.9;
const RECALL_LIMIT = 6;
const MAX_MEMORIES_PER_USER = 200;

export type RecalledMemory = {
  id: string;
  content: string;
  category: string;
  similarity: number;
};

export async function recallMemories(
  userId: string,
  embedding: number[],
  limit = RECALL_LIMIT,
): Promise<RecalledMemory[]> {
  if (embedding.length === 0) return [];
  const vectorStr = `[${embedding.join(",")}]`;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; content: string; category: string; similarity: number }>
  >`
    SELECT id, content, category,
      1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM "UserMemory"
    WHERE "userId" = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  return rows.filter((r) => r.similarity >= RECALL_THRESHOLD);
}

const EXTRACTION_PROMPT = `You maintain the long-term memory of a personal AI assistant.
Read the exchange below and extract durable facts about the USER worth remembering
across future conversations: who they are, what they do, preferences, interests,
constraints, ongoing projects or goals.

Rules:
- Extract at most 3 facts. Usually 0 or 1 is correct — most exchanges contain nothing durable.
- Only facts about the user. Never store general knowledge, the assistant's answer, or one-off trivia.
- Each fact must stand alone without conversation context, phrased in third person, e.g. "Works as a React developer".
- category is one of: "identity", "preference", "project", "interest", "other".

Respond with ONLY a JSON array (no markdown fences), e.g.:
[{"fact": "...", "category": "preference"}]
Return [] if nothing is worth remembering.

## Exchange
User: {{USER_MESSAGE}}

Assistant (truncated): {{ASSISTANT_ANSWER}}`;

type ExtractedFact = { fact: string; category: string };

// Durable facts are things the user says about *themselves*. A message with no
// first-person language ("best laptops 2026", "how does pgvector work") can't
// contain one, so skip the extraction LLM call entirely for those turns.
const FIRST_PERSON_RE = /\b(i|i'm|i've|i'd|i'll|my|me|mine|myself|we|we're|our)\b/i;

function parseFacts(raw: string): ExtractedFact[] {
  // Tolerate models that wrap the JSON in fences despite instructions
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f: any) => typeof f?.fact === "string" && f.fact.trim().length > 0)
      .slice(0, 3)
      .map((f: any) => ({
        fact: String(f.fact).trim().slice(0, 500),
        category: ["identity", "preference", "project", "interest", "other"].includes(f.category)
          ? f.category
          : "other",
      }));
  } catch {
    return [];
  }
}

async function isDuplicate(userId: string, embedding: number[]): Promise<boolean> {
  const vectorStr = `[${embedding.join(",")}]`;
  const rows = await prisma.$queryRaw<Array<{ similarity: number }>>`
    SELECT 1 - (embedding <=> ${vectorStr}::vector) AS similarity
    FROM "UserMemory"
    WHERE "userId" = ${userId} AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT 1
  `;
  return rows.length > 0 && rows[0]!.similarity >= DEDUPE_THRESHOLD;
}

/**
 * Extract and persist memories from a finished exchange.
 * Fire-and-forget: never throws, never blocks the response stream.
 */
export async function extractAndStoreMemories(
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantAnswer: string,
): Promise<void> {
  try {
    if (!FIRST_PERSON_RE.test(userMessage)) return;

    const count = await prisma.userMemory.count({ where: { userId } });
    if (count >= MAX_MEMORIES_PER_USER) return;

    const prompt = EXTRACTION_PROMPT.replace("{{USER_MESSAGE}}", userMessage.slice(0, 2000)).replace(
      "{{ASSISTANT_ANSWER}}",
      assistantAnswer.slice(0, 1500),
    );

    // flash-lite: extraction is a trivial task, and on the free tier each model
    // has its own RPM/RPD bucket — this keeps background extraction from
    // competing with the user-facing chat calls for gemini-2.5-flash quota.
    const { text } = await generateText({
      model: google("gemini-2.5-flash-lite"),
      prompt,
    });

    const facts = parseFacts(text);
    if (facts.length === 0) return;

    for (const { fact, category } of facts) {
      const embedding = await embedQuery(fact);
      if (await isDuplicate(userId, embedding)) continue;

      const vectorStr = `[${embedding.join(",")}]`;
      await prisma.$executeRaw`
        INSERT INTO "UserMemory" (id, "userId", content, category, embedding, "sourceConversationId", "createdAt")
        VALUES (gen_random_uuid(), ${userId}, ${fact}, ${category}, ${vectorStr}::vector, ${conversationId}, NOW())
      `;
      console.log(`[memory] Stored (${category}): "${fact}"`);
    }
  } catch (err) {
    console.error("[memory] Extraction failed:", err);
  }
}

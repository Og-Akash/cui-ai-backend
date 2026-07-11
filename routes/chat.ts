import { Router } from "express";
import { streamText } from "ai";
import { google, openRouterModel } from "../lib/models";
import { prisma } from "../lib/prisma";
import { embedQuery } from "../lib/embedding";
import { resolveSearchContext } from "../services/orchestrator";
import { storeSearchResult } from "../services/vectorSearch";
import { recallMemories, extractAndStoreMemories, type RecalledMemory } from "../services/memory";
import { buildSystemPrompt, buildChatPrompt, SYSTEM_PROMPT, FOLLOW_UPS_PROMPT, type PersonaContext } from "../prompt";
import { cached, cacheDelete, cacheKeys } from "../lib/cache";

export const chatRouter = Router();

const HISTORY_MESSAGE_LIMIT = 12;
// Tiered truncation: the newest messages carry the conversational thread and get
// a generous cap; older ones only need to convey topic continuity, so they get a
// tight one. Keeps 12 turns of context at roughly a third of the token cost.
const HISTORY_RECENT_COUNT = 4;
const HISTORY_RECENT_MAX_CHARS = 1200;
const HISTORY_OLDER_MAX_CHARS = 300;

/** Strip storage/protocol artifacts so history injected into the prompt is clean. */
function cleanMessageForHistory(content: string, maxChars = HISTORY_RECENT_MAX_CHARS): string {
  return content
    .replace(/<SOURCES_DATA>[\s\S]*?<\/SOURCES_DATA>/g, "")
    .replace(/<\/?ANSWER>/g, "")
    .replace(/<FOLLOW_UPS>[\s\S]*?(<\/FOLLOW_UPS>|$)/g, "")
    .trim()
    .slice(0, maxChars);
}

/** The active persona (or an explicitly requested one) for prompt injection. */
async function resolvePersona(userId: string, personaId?: string): Promise<PersonaContext> {
  const select = {
    name: true,
    aboutYou: true,
    occupation: true,
    traits: true,
    responseStyle: true,
    customInstructions: true,
  } as const;

  if (personaId) {
    return prisma.persona.findFirst({ where: { id: personaId, userId }, select });
  }

  return cached(cacheKeys.activePersona(userId), 60 * 1000, () =>
    prisma.persona.findFirst({ where: { userId, isActive: true }, select }),
  );
}

chatRouter.post("/chat", async (req, res) => {
  const userId = req.userId!;
  const {
    query,
    prompt,
    conversationId,
    modelId = "gemini-2.5-flash",
    provider = "Google",
    webSearchEnabled = true,
    personaId,
  } = req.body as {
    query?: string;
    prompt?: string;
    conversationId?: string;
    modelId?: string;
    provider?: string;
    webSearchEnabled?: boolean;
    personaId?: string;
  };

  const activeQuery = query || prompt;

  if (!activeQuery?.trim()) {
    res.status(400).json({ message: "query is required" });
    return;
  }

  // ── 1. Resolve or create conversation ────────────────────────────────────
  let conversation = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      })
    : null;

  const isNewConversation = !conversation;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        title: activeQuery.slice(0, 120), // Use first 120 chars as title
      },
    });
  }

  // ── 2. Short-term memory: prior messages of this thread (before persisting
  //       the current one) ───────────────────────────────────────────────────
  let historyText = "";
  if (!isNewConversation) {
    const priorMessages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_MESSAGE_LIMIT,
      select: { role: true, content: true },
    });
    historyText = priorMessages
      .reverse()
      .map((m, i, all) => {
        const isRecent = i >= all.length - HISTORY_RECENT_COUNT;
        const maxChars = isRecent ? HISTORY_RECENT_MAX_CHARS : HISTORY_OLDER_MAX_CHARS;
        return `${m.role}: ${cleanMessageForHistory(m.content, maxChars)}`;
      })
      .join("\n\n");
  }

  // ── 3. Persist user message ───────────────────────────────────────────────
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "User",
      content: activeQuery,
    },
  });
  cacheDelete(cacheKeys.conversations(userId));

  // ── 4. Embed the query once — shared by the web-search cache and long-term
  //       memory recall. Best-effort: an embedding outage degrades gracefully.
  let embedding: number[] = [];
  try {
    embedding = await embedQuery(activeQuery);
  } catch (err) {
    console.error("[chat] Query embedding failed:", err);
  }

  // ── 5. Personalisation context: persona + recalled memories ──────────────
  const [persona, memories] = await Promise.all([
    resolvePersona(userId, personaId).catch((err): PersonaContext => {
      console.error("[chat] Persona lookup failed:", err);
      return null;
    }),
    recallMemories(userId, embedding).catch((err): RecalledMemory[] => {
      console.error("[chat] Memory recall failed:", err);
      return [];
    }),
  ]);

  // ── 6. Web search context (vector cache → Tavily fallback) ───────────────
  let sources: any[] = [];
  let images: string[] = [];
  let cachedHit = false;

  if (webSearchEnabled) {
    try {
      const context = await resolveSearchContext(activeQuery, embedding);
      sources = context.sources;
      images = context.images;
      cachedHit = context.cached;
    } catch (err) {
      // Web search is best-effort — degrade to a no-context answer
      console.error("[chat] Search context failed, answering without sources:", err);
    }
  }

  // ── 7. Build prompts ──────────────────────────────────────────────────────
  // Tavily "advanced" content chunks can run 1–2k chars each; 800 is enough for
  // the model to ground and cite a source without paying for the whole chunk.
  const SOURCE_CONTENT_MAX_CHARS = 800;
  const sourcesText =
    sources.length > 0
      ? sources
          .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${(s.content ?? "").slice(0, SOURCE_CONTENT_MAX_CHARS)}`)
          .join("\n\n")
      : "No web search results available.";

  const promptText = buildChatPrompt({
    query: activeQuery,
    sourcesText,
    imagesText: images.slice(0, 8).join("\n"),
    historyText,
  });
  const systemPrompt = buildSystemPrompt(persona, memories);

  // ── 8. Stream LLM response ────────────────────────────────────────────────
  // Wire protocol (must stay in sync with frontend usePurplexityChat):
  //   <SOURCES>[…]</SOURCES>\n<META>{…}</META>\n then raw answer text.
  // Sources + meta are known before generation starts, so they are sent
  // first — the UI can render source cards and pin the conversation URL
  // while the answer is still streaming.
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const slimSources = sources.map((s) => ({ url: s.url, title: s.title }));
  res.write(`<SOURCES>${JSON.stringify(slimSources)}</SOURCES>\n`);
  res.write(`<META>${JSON.stringify({ conversationId: conversation.id, cached: cachedHit })}</META>\n`);

  const userGeminiKey = req.headers["x-gemini-key"] as string | undefined;
  const userOpenRouterKey = req.headers["x-openrouter-key"] as string | undefined;
  const activeModel = provider === "OpenRouter"
    ? openRouterModel(modelId, userOpenRouterKey)
    : google(modelId, userGeminiKey);

  let fullAssistantResponse = "";

  try {
    const result = streamText({
      model: activeModel,
      prompt: promptText,
      system: systemPrompt,
    });

    for await (const textPart of result.textStream) {
      fullAssistantResponse += textPart;
      res.write(textPart);
    }
  } catch (err) {
    console.error("[chat] LLM stream failed:", err);
    if (!fullAssistantResponse) {
      res.write("Something went wrong while generating the answer. Please try again.");
    }
  } finally {
    res.end();
  }

  if (!fullAssistantResponse) return;

  // ── 9. Persist assistant message (after stream ends) ─────────────────────
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "Assistant",
      content: fullAssistantResponse + `\n<SOURCES_DATA>${JSON.stringify(slimSources)}</SOURCES_DATA>`,
      model: modelId,
      modelProvider: provider as 'Google' | 'OpenRouter',
    },
  });
  cacheDelete(cacheKeys.conversations(userId));

  // ── 10. Fire-and-forget: search cache write + long-term memory extraction ─
  if (webSearchEnabled && !cachedHit && embedding.length > 0) {
    storeSearchResult(activeQuery, embedding, sources, fullAssistantResponse).catch(
      (err) => console.error("[cache] Failed to store search result:", err),
    );
  }

  extractAndStoreMemories(userId, conversation.id, activeQuery, fullAssistantResponse).catch(
    (err) => console.error("[memory] Extraction crashed:", err),
  );
});

chatRouter.get("/chat/followUps", async (req, res) => {
  const userId = req.userId!;
  const { conversationId, modelId = "gemini-2.5-flash", provider = "Google" } = req.query as {
    conversationId: string;
    modelId?: string;
    provider?: 'Google' | 'OpenRouter';
  };

  if (!conversationId) {
    res.status(400).json({ message: "conversationId is required" });
    return;
  }

  // Verify ownership
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 20, // last 20 messages give enough context without blowing the token budget
      },
    },
  });

  if (!conversation) {
    res.status(404).json({ message: "Conversation not found" });
    return;
  }

  // Build a short conversation history for the follow-ups prompt
  const history = conversation.messages
    .map((m) => `${m.role}: ${cleanMessageForHistory(m.content)}`)
    .join("\n\n");

  const followUpsPrompt = FOLLOW_UPS_PROMPT.replace("{{CONVERSATION_HISTORY}}", history);

  const userGeminiKey = req.headers["x-gemini-key"] as string | undefined;
  const userOpenRouterKey = req.headers["x-openrouter-key"] as string | undefined;
  const activeModel = provider === "OpenRouter"
    ? openRouterModel(modelId, userOpenRouterKey)
    : google(modelId, userGeminiKey);

  const result = streamText({
    model: activeModel,
    prompt: followUpsPrompt,
    system: SYSTEM_PROMPT,
  });

  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");

  for await (const textPart of result.textStream) {
    res.write(textPart);
  }

  res.end();
});

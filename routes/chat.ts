import { Router } from "express";
import { streamText } from "ai";
import { googleModel } from "../lib/models";
import { prisma } from "../lib/prisma";
import { resolveSearchContext } from "../services/orchestrator";
import { storeSearchResult } from "../services/vectorSearch";
import { PROMPT_TEMPLATE, SYSTEM_PROMPT, FOLLOW_UPS_PROMPT } from "../prompt";

export const chatRouter = Router();

chatRouter.post("/chat", async (req, res) => {
  const userId = req.userId!;
  const { query, conversationId } = req.body as {
    query: string;
    conversationId?: string;
  };

  if (!query?.trim()) {
    res.status(400).json({ message: "query is required" });
    return;
  }

  // ── 1. Resolve or create conversation ────────────────────────────────────
  let conversation = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      })
    : null;

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId,
        title: query.slice(0, 120), // Use first 120 chars as title
      },
    });
  }

  // ── 2. Persist user message ───────────────────────────────────────────────
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "User",
      content: query,
    },
  });

  // ── 3. Orchestration: embed → vector cache → web search fallback ─────────
  const { sources, cached, embedding } = await resolveSearchContext(query);

  // ── 4. Build prompt ───────────────────────────────────────────────────────
  const sourcesText = sources
    .map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.content}`)
    .join("\n\n");

  const prompt = PROMPT_TEMPLATE.replace("{{WEB_SEARCH_RESULTS}}", sourcesText).replace(
    "{{USER_QUERY}}",
    query,
  );

  // ── 5. Stream LLM response ────────────────────────────────────────────────
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");

  const result = streamText({
    model: googleModel,
    prompt,
    system: SYSTEM_PROMPT,
  });

  let fullAssistantResponse = "";

  for await (const textPart of result.textStream) {
    fullAssistantResponse += textPart;
    res.write(textPart);
  }

  // ── 6. Flush sources as a delimiter-separated event ───────────────────────
  res.write("\n<SOURCES>\n");
  res.write(JSON.stringify(sources.map((s) => ({ url: s.url, title: s.title }))));

  // ── 7. Flush conversation id + cache status ────────────────────────────────
  res.write("\n<META>\n");
  res.write(JSON.stringify({ conversationId: conversation.id, cached }));

  res.end();

  // ── 8. Persist assistant message (fire-and-forget after stream ends) ───────
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: "Assistant",
      content: fullAssistantResponse,
      model: "gemini-2.5-flash",
      modelProvider: "Google",
    },
  });

  // ── 9. Cache the result for future similar queries ─────────────────────────
  if (!cached) {
    storeSearchResult(query, embedding, sources, fullAssistantResponse).catch(
      (err) => console.error("[cache] Failed to store search result:", err),
    );
  }
});

chatRouter.get("/chat/followUps", async (req, res) => {
  const userId = req.userId!;
  const { conversationId } = req.query as { conversationId: string };

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
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  const followUpsPrompt = FOLLOW_UPS_PROMPT.replace("{{CONVERSATION_HISTORY}}", history);

  const result = streamText({
    model: googleModel,
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

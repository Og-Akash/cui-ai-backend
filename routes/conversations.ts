import { Router } from "express";
import { prisma } from "../lib/prisma";
import { cached, cacheDelete, cacheKeys } from "../lib/cache";

export const conversationsRouter = Router();

// ---------------------------------------------------------------------------
// GET /conversations
// Returns all conversations for the authenticated user, newest first.
// Cached for 60s; every write path (new message, delete) invalidates.
// ---------------------------------------------------------------------------
conversationsRouter.get("/conversations", async (req, res) => {
  const userId = req.userId!;

  const shaped = await cached(cacheKeys.conversations(userId), 60 * 1000, async () => {
    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { messages: true },
        },
        // Grab the first user message to show a preview snippet
        messages: {
          where: { role: "User" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { content: true },
        },
      },
    });

    return conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messageCount: c._count.messages,
      preview: c.messages[0]?.content?.slice(0, 160) ?? c.title,
    }));
  });

  res.json({ conversations: shaped });
});

// ---------------------------------------------------------------------------
// GET /conversation/:conversationId
// Returns full conversation with all messages, ordered chronologically.
// ---------------------------------------------------------------------------
conversationsRouter.get("/conversation/:conversationId", async (req, res) => {
  const userId = req.userId!;
  const { conversationId } = req.params;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId }, // Enforce ownership
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          model: true,
          modelProvider: true,
          createdAt: true,
        },
      },
    },
  });

  if (!conversation) {
    res.status(404).json({ message: "Conversation not found" });
    return;
  }

  res.json({ conversation });
});

// ---------------------------------------------------------------------------
// DELETE /conversation/:conversationId — delete a single thread.
// ---------------------------------------------------------------------------
conversationsRouter.delete("/conversation/:conversationId", async (req, res) => {
  const userId = req.userId!;
  const { conversationId } = req.params;

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });

  if (!conversation) {
    res.status(404).json({ message: "Conversation not found" });
    return;
  }

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId } }),
    prisma.conversation.delete({ where: { id: conversationId } }),
  ]);

  cacheDelete(cacheKeys.conversations(userId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /conversations — clear the user's entire chat history.
// ---------------------------------------------------------------------------
conversationsRouter.delete("/conversations", async (req, res) => {
  const userId = req.userId!;

  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversation: { userId } } }),
    prisma.conversation.deleteMany({ where: { userId } }),
  ]);

  cacheDelete(cacheKeys.conversations(userId));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /history/export — full chat history as a portable JSON document
// (History & Sync tab → "Export history").
// ---------------------------------------------------------------------------
conversationsRouter.get("/history/export", async (req, res) => {
  const userId = req.userId!;

  const conversations = await prisma.conversation.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, model: true, modelProvider: true, createdAt: true },
      },
    },
  });

  res.setHeader("Content-Disposition", `attachment; filename="purplexity-history-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    conversationCount: conversations.length,
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      messages: c.messages,
    })),
  });
});

import { Router } from "express";
import { prisma } from "../lib/prisma";

export const conversationsRouter = Router();

// ---------------------------------------------------------------------------
// GET /conversations
// Returns all conversations for the authenticated user, newest first.
// Each entry includes the message count (useful for UI list views).
// ---------------------------------------------------------------------------
conversationsRouter.get("/conversations", async (req, res) => {
  const userId = req.userId!;

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

  const shaped = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    messageCount: c._count.messages,
    preview: c.messages[0]?.content?.slice(0, 160) ?? c.title,
  }));

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

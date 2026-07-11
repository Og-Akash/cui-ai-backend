import { Router } from "express";
import { prisma } from "../lib/prisma";

export const memoriesRouter = Router();

// ---------------------------------------------------------------------------
// GET /memories — everything the agent remembers about the user.
// ---------------------------------------------------------------------------
memoriesRouter.get("/memories", async (req, res) => {
  const userId = req.userId!;
  const memories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, category: true, sourceConversationId: true, createdAt: true },
  });
  res.json({ memories });
});

// ---------------------------------------------------------------------------
// DELETE /memories/:id — forget a single memory.
// DELETE /memories — forget everything.
// ---------------------------------------------------------------------------
memoriesRouter.delete("/memories/:id", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  const { count } = await prisma.userMemory.deleteMany({ where: { id, userId } });
  if (count === 0) {
    res.status(404).json({ message: "Memory not found" });
    return;
  }
  res.json({ ok: true });
});

memoriesRouter.delete("/memories", async (req, res) => {
  const userId = req.userId!;
  await prisma.userMemory.deleteMany({ where: { userId } });
  res.json({ ok: true });
});

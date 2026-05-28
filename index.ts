import express from "express";
import { authMiddleware } from "./middleware";
import { prisma } from "./lib/prisma";
import { chatRouter } from "./routes/chat";
import { conversationsRouter } from "./routes/conversations";

const port = 4000;
const app = express();

app.use(express.json());
app.use(authMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(chatRouter);
app.use(conversationsRouter);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  const userId = req.userId;

  const user = await prisma.user.findFirst({
    where: { id: userId },
  });

  res.json({ user });
});

app.listen(port, () => console.log(`Server is running on port ${port}`));

import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware";
import { chatRouter } from "./routes/chat";
import { conversationsRouter } from "./routes/conversations";

const port = process.env.PORT;
const app = express();

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());
app.use(authMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(chatRouter);
app.use(conversationsRouter);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  res.status(200).json({
    message: "Service is up"
  })
});

app.listen(port, () => console.log(`Server is running on port ${port}`));

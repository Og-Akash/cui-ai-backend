import express from "express";
import cors from "cors";
import { authMiddleware } from "./authMiddleware";
import { chatRouter } from "./routes/chat";
import { conversationsRouter } from "./routes/conversations";
import { usersRouter } from "./routes/users";
import { personasRouter } from "./routes/personas";
import { memoriesRouter } from "./routes/memories";

const port = process.env.PORT;
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests without an Origin header (e.g. Postman, curl, server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(authMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use(chatRouter);
app.use(conversationsRouter);
app.use(usersRouter);
app.use(personasRouter);
app.use(memoriesRouter);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  res.status(200).json({
    message: "Service is up"
  })
});

app.listen(port, () => console.log(`Server is running on port ${port}`));

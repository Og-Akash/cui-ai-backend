import { Router } from "express";
import { prisma } from "../lib/prisma";
import { cached, cacheDelete, cacheKeys } from "../lib/cache";

export const usersRouter = Router();

// ---------------------------------------------------------------------------
// GET /me — the authenticated user's profile (row is auto-provisioned by
// authMiddleware, so it always exists).
// ---------------------------------------------------------------------------
usersRouter.get("/me", async (req, res) => {
  const userId = req.userId!;

  const user = await cached(cacheKeys.profile(userId), 5 * 60 * 1000, () =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, provider: true, preferences: true, createdAt: true },
    }),
  );

  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }

  res.json({ user });
});

// ---------------------------------------------------------------------------
// PATCH /me — update display name and/or client preferences.
// Preferences are merged shallowly so clients can patch a single key.
// ---------------------------------------------------------------------------
usersRouter.patch("/me", async (req, res) => {
  const userId = req.userId!;
  const { name, preferences } = req.body as {
    name?: string;
    preferences?: Record<string, unknown>;
  };

  if (name !== undefined && (typeof name !== "string" || name.length > 80)) {
    res.status(400).json({ message: "name must be a string of at most 80 characters" });
    return;
  }
  if (preferences !== undefined && (typeof preferences !== "object" || preferences === null || Array.isArray(preferences))) {
    res.status(400).json({ message: "preferences must be an object" });
    return;
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });

  const mergedPreferences =
    preferences !== undefined
      ? { ...((existing?.preferences as Record<string, unknown>) ?? {}), ...preferences }
      : undefined;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(mergedPreferences !== undefined
        ? { preferences: mergedPreferences as Record<string, never> }
        : {}),
    },
    select: { id: true, email: true, name: true, provider: true, preferences: true, createdAt: true },
  });

  cacheDelete(cacheKeys.profile(userId));
  res.json({ user });
});

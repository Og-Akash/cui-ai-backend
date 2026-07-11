import type { NextFunction, Request, Response } from "express";
import { supabase } from "./lib/client";
import { prisma } from "./lib/prisma";
import { cacheGet, cacheSet, cacheKeys } from "./lib/cache";

/**
 * Lazily provisions a row in our own User table for a Supabase-authenticated
 * user. Conversations, personas and memories all FK onto User, but signup
 * happens entirely on the Supabase side — so the first authenticated request
 * creates the row. Cached so it costs one DB roundtrip per user per hour.
 */
async function ensureUserRow(userId: string, claims: Record<string, any>) {
  if (cacheGet(cacheKeys.userProvisioned(userId))) return;

  const email: string = claims.email ?? "";
  const metaName =
    claims.user_metadata?.name || claims.user_metadata?.full_name || "";
  const isOAuth = claims.app_metadata?.provider === "google";

  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email,
      name: metaName,
      provider: isOAuth ? "Google" : "Email",
    },
  });

  cacheSet(cacheKeys.userProvisioned(userId), true, 60 * 60 * 1000);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization;

  if (!token) {
    res.status(403).json({ message: "Unauthorized" });
    return;
  }

  const { data, error } = await supabase.auth.getClaims(token);

  if (error || !data?.claims.sub) {
    res.status(403).json({ message: "Unauthorized" });
    return;
  }

  const userId = data.claims.sub;
  req.userId = userId;

  try {
    await ensureUserRow(userId, data.claims as Record<string, any>);
  } catch (err) {
    console.error("[auth] Failed to provision user row:", err);
    res.status(500).json({ message: "Failed to initialise user profile" });
    return;
  }

  next();
}

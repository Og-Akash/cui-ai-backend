import { Router } from "express";
import { prisma } from "../lib/prisma";
import { cacheDelete, cacheKeys } from "../lib/cache";

export const personasRouter = Router();

export const RESPONSE_STYLES = [
  "balanced",
  "creative",
  "concise",
  "technical",
  "friendly",
  "academic",
] as const;

const PERSONA_SELECT = {
  id: true,
  name: true,
  aboutYou: true,
  occupation: true,
  traits: true,
  responseStyle: true,
  customInstructions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

function invalidatePersonaCaches(userId: string) {
  cacheDelete(cacheKeys.personas(userId));
  cacheDelete(cacheKeys.activePersona(userId));
}

type PersonaInput = {
  name?: string;
  aboutYou?: string;
  occupation?: string;
  traits?: string[];
  responseStyle?: string;
  customInstructions?: string;
};

function validatePersonaInput(body: PersonaInput, { requireName }: { requireName: boolean }): string | null {
  if (requireName && !body.name?.trim()) return "name is required";
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 60)) {
    return "name must be a string of at most 60 characters";
  }
  if (body.aboutYou !== undefined && body.aboutYou.length > 2000) return "aboutYou is too long (max 2000)";
  if (body.occupation !== undefined && body.occupation.length > 200) return "occupation is too long (max 200)";
  if (body.customInstructions !== undefined && body.customInstructions.length > 3000) {
    return "customInstructions is too long (max 3000)";
  }
  if (body.traits !== undefined && (!Array.isArray(body.traits) || body.traits.some((t) => typeof t !== "string"))) {
    return "traits must be an array of strings";
  }
  if (body.responseStyle !== undefined && !RESPONSE_STYLES.includes(body.responseStyle as any)) {
    return `responseStyle must be one of: ${RESPONSE_STYLES.join(", ")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET /personas — all customization profiles for the user.
// ---------------------------------------------------------------------------
personasRouter.get("/personas", async (req, res) => {
  const userId = req.userId!;
  const personas = await prisma.persona.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: PERSONA_SELECT,
  });
  res.json({ personas });
});

// ---------------------------------------------------------------------------
// POST /personas — create a profile. The user's first profile is activated
// automatically.
// ---------------------------------------------------------------------------
personasRouter.post("/personas", async (req, res) => {
  const userId = req.userId!;
  const body = req.body as PersonaInput;

  const validationError = validatePersonaInput(body, { requireName: true });
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const existingCount = await prisma.persona.count({ where: { userId } });

  const persona = await prisma.persona.create({
    data: {
      userId,
      name: body.name!.trim(),
      aboutYou: body.aboutYou ?? "",
      occupation: body.occupation ?? "",
      traits: body.traits ?? [],
      responseStyle: body.responseStyle ?? "balanced",
      customInstructions: body.customInstructions ?? "",
      isActive: existingCount === 0,
    },
    select: PERSONA_SELECT,
  });

  invalidatePersonaCaches(userId);
  res.status(201).json({ persona });
});

// ---------------------------------------------------------------------------
// PATCH /personas/:id — update a profile's fields.
// ---------------------------------------------------------------------------
personasRouter.patch("/personas/:id", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;
  const body = req.body as PersonaInput;

  const validationError = validatePersonaInput(body, { requireName: false });
  if (validationError) {
    res.status(400).json({ message: validationError });
    return;
  }

  const existing = await prisma.persona.findFirst({ where: { id, userId } });
  if (!existing) {
    res.status(404).json({ message: "Persona not found" });
    return;
  }

  const persona = await prisma.persona.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.aboutYou !== undefined ? { aboutYou: body.aboutYou } : {}),
      ...(body.occupation !== undefined ? { occupation: body.occupation } : {}),
      ...(body.traits !== undefined ? { traits: body.traits } : {}),
      ...(body.responseStyle !== undefined ? { responseStyle: body.responseStyle } : {}),
      ...(body.customInstructions !== undefined ? { customInstructions: body.customInstructions } : {}),
    },
    select: PERSONA_SELECT,
  });

  invalidatePersonaCaches(userId);
  res.json({ persona });
});

// ---------------------------------------------------------------------------
// POST /personas/:id/activate — make this the single active profile.
// POST /personas/deactivate — no active profile (agent uses defaults).
// ---------------------------------------------------------------------------
personasRouter.post("/personas/deactivate", async (req, res) => {
  const userId = req.userId!;
  await prisma.persona.updateMany({ where: { userId }, data: { isActive: false } });
  invalidatePersonaCaches(userId);
  res.json({ ok: true });
});

personasRouter.post("/personas/:id/activate", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  const existing = await prisma.persona.findFirst({ where: { id, userId } });
  if (!existing) {
    res.status(404).json({ message: "Persona not found" });
    return;
  }

  await prisma.$transaction([
    prisma.persona.updateMany({ where: { userId }, data: { isActive: false } }),
    prisma.persona.update({ where: { id }, data: { isActive: true } }),
  ]);

  invalidatePersonaCaches(userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /personas/:id
// ---------------------------------------------------------------------------
personasRouter.delete("/personas/:id", async (req, res) => {
  const userId = req.userId!;
  const { id } = req.params;

  const existing = await prisma.persona.findFirst({ where: { id, userId } });
  if (!existing) {
    res.status(404).json({ message: "Persona not found" });
    return;
  }

  await prisma.persona.delete({ where: { id } });
  invalidatePersonaCaches(userId);
  res.json({ ok: true });
});

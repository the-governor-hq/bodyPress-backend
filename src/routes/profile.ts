// ---------------------------------------------------------------------------
// Profile routes — read & update authenticated user's profile / preferences
//
//   GET   /v1/profile
//   PATCH /v1/profile
// ---------------------------------------------------------------------------
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

const patchSchema = z.object({
  name: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  goals: z.array(z.string().max(60)).max(10).optional(),
  notifyAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:mm format")
    .optional(),
  newsletterOptIn: z.boolean().optional(),
  onboardingDone: z.boolean().optional(),
});

export const profileRouter = Router();

// GET /v1/profile
profileRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        goals: true,
        newsletterOptIn: true,
        subscribedAt: true,
        notifyAt: true,
        onboardingDone: true,
        createdAt: true,
        connections: {
          select: {
            provider: true,
            status: true,
            connectedAt: true,
            lastSyncedAt: true,
          },
        },
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
});

// PATCH /v1/profile
profileRouter.patch("/", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: {
        id: true,
        email: true,
        name: true,
        timezone: true,
        goals: true,
        newsletterOptIn: true,
        notifyAt: true,
        onboardingDone: true,
      },
    });

    return res.status(200).json({ user: updated });
  } catch (error) {
    return next(error);
  }
});

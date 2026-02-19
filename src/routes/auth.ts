// ---------------------------------------------------------------------------
// Auth routes — passwordless magic-link flow
//
//   POST /v1/auth/request-link  { email, name? }
//   GET  /v1/auth/verify?token=<token>
//   GET  /v1/auth/me            (auth required — returns current user)
// ---------------------------------------------------------------------------
import { Router } from "express";
import { z } from "zod";
import { requestMagicLink, verifyMagicLink } from "../services/auth.service.js";
import { requireAuth } from "../auth/passport.js";
import { authLimiter } from "../lib/rate-limit.js";
import { prisma } from "../db/prisma.js";

const requestSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
});

export const authRouter = Router();

// POST /v1/auth/request-link
authRouter.post("/request-link", authLimiter, async (req, res, next) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    await requestMagicLink(parsed.data.email, parsed.data.name);

    // Always return 200 — don't leak whether the email exists
    return res.status(200).json({
      message: "If that email exists, a sign-in link has been sent.",
    });
  } catch (error) {
    return next(error);
  }
});

// GET /v1/auth/verify?token=xxx
authRouter.get("/verify", async (req, res, next) => {
  try {
    const token = z.string().min(1).safeParse(req.query.token);
    if (!token.success) {
      return res.status(400).json({ error: "token query parameter required" });
    }

    const result = await verifyMagicLink(token.data);

    return res.status(200).json({
      token: result.token,
      userId: result.userId,
      email: result.email,
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "NOT_FOUND" || code === "ALREADY_USED" || code === "EXPIRED") {
      return res.status(401).json({ error: (err as Error).message });
    }
    return next(err);
  }
});

// GET /v1/auth/me
authRouter.get("/me", requireAuth, async (req, res, next) => {
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
      },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
});

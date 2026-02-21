// ---------------------------------------------------------------------------
// POST /v1/subscribers   — newsletter sign-up (public)
// DELETE /v1/subscribers — unsubscribe (public, by email query param)
// ---------------------------------------------------------------------------
import { Router } from "express";
import { z } from "zod";
import { subscribe, unsubscribe } from "../services/subscriber.service.js";
import { subscribeLimiter } from "../lib/rate-limit.js";

const subscribeSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
  goals: z.array(z.string()).max(10).optional(),
});

export const subscribersRouter = Router();

subscribersRouter.post("/", subscribeLimiter, async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    await subscribe(parsed.data);

    // Always return 200 with a clear message
    return res.status(200).json({
      message: "Check your email! We've sent you a link to confirm your subscription.",
    });
  } catch (error) {
    return next(error);
  }
});

subscribersRouter.delete("/", subscribeLimiter, async (req, res, next) => {
  try {
    const email = z.string().email().safeParse(req.query.email);
    if (!email.success) {
      return res.status(400).json({ error: "Valid email query parameter required" });
    }

    await unsubscribe(email.data);
    return res.status(200).json({ message: "Unsubscribed" });
  } catch (error) {
    return next(error);
  }
});

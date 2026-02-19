// ---------------------------------------------------------------------------
// In-memory sliding-window rate limiter (no Redis dep for simplicity)
// Use express-rate-limit in production when you want Redis backing.
// ---------------------------------------------------------------------------
import type { Request, Response, NextFunction } from "express";

interface Window {
  count: number;
  resetAt: number;
}

const store = new Map<string, Window>();

function getKey(req: Request): string {
  const ip =
    (req.headers["fly-client-ip"] as string | undefined) ??
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";
  return ip;
}

/** Create a rate-limit middleware: max requests per windowMs. */
export function rateLimit(options: {
  max: number;
  windowMs: number;
  message?: string;
}) {
  const { max, windowMs, message = "Too many requests, please slow down." } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getKey(req);
    const now = Date.now();
    const win = store.get(key);

    if (!win || now > win.resetAt) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    win.count += 1;
    if (win.count > max) {
      const retryAfter = Math.ceil((win.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      res.status(429).json({ error: message });
      return;
    }

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max - win.count));
    next();
  };
}

// Pre-baked limiters ──────────────────────────────────────────────────────────

/** 100 req / 1 min — general API */
export const apiLimiter = rateLimit({ max: 100, windowMs: 60_000 });

/** 10 req / 15 min — auth endpoints (magic link requests) */
export const authLimiter = rateLimit({
  max: 10,
  windowMs: 15 * 60_000,
  message: "Too many auth attempts. Please wait 15 minutes.",
});

/** 5 req / 10 min — subscribe endpoint */
export const subscribeLimiter = rateLimit({
  max: 5,
  windowMs: 10 * 60_000,
  message: "Too many subscription attempts. Please wait a bit.",
});

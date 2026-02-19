// ---------------------------------------------------------------------------
// Webhook signature verification for Garmin and Fitbit
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// ── Garmin ────────────────────────────────────────────────────────────────────
// Garmin signs the raw body with HMAC-SHA1 using the consumer secret appended
// with "&" (OAuth 1.0-style signature base). Header: X-Garmin-Signature
export function verifyGarminSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!env.GARMIN_WEBHOOK_SECRET) {
    logger.warn("GARMIN_WEBHOOK_SECRET not set — skipping signature verification");
    next();
    return;
  }

  const signature = req.headers["x-garmin-signature"] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: "Missing Garmin webhook signature" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body not available" });
    return;
  }

  const expected = crypto
    .createHmac("sha1", `${env.GARMIN_CLIENT_SECRET}&`)
    .update(rawBody)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn({ signature }, "Garmin webhook signature mismatch");
    res.status(401).json({ error: "Invalid Garmin webhook signature" });
    return;
  }

  next();
}

// ── Fitbit ────────────────────────────────────────────────────────────────────
// Fitbit signs with HMAC-SHA1 using (clientSecret + "&" + tokenSecret) but for
// subscriber callbacks the secret is clientSecret+"&".
// Header: X-Fitbit-Signature (Base64-encoded)
export function verifyFitbitSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!env.FITBIT_CLIENT_SECRET) {
    logger.warn("FITBIT_CLIENT_SECRET not set — skipping signature verification");
    next();
    return;
  }

  const signature = req.headers["x-fitbit-signature"] as string | undefined;
  if (!signature) {
    res.status(401).json({ error: "Missing Fitbit webhook signature" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: "Raw body not available" });
    return;
  }

  const key = `${env.FITBIT_CLIENT_SECRET}&`;
  const expected = crypto
    .createHmac("sha1", key)
    .update(rawBody)
    .digest("base64");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    logger.warn({ signature }, "Fitbit webhook signature mismatch");
    res.status(401).json({ error: "Invalid Fitbit webhook signature" });
    return;
  }

  next();
}

// ── Raw-body capture middleware ───────────────────────────────────────────────
// Must be mounted BEFORE express.json() on webhook routes.
export function captureRawBody(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    (req as Request & { rawBody?: Buffer }).rawBody = raw;
    try {
      (req as Request & { body?: unknown }).body = JSON.parse(raw.toString("utf8"));
    } catch {
      (req as Request & { body?: unknown }).body = {};
    }
    next();
  });
}

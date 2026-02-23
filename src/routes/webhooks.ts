// ---------------------------------------------------------------------------
// Webhook routes — incoming push notifications from Garmin and Fitbit
//
//   POST /webhooks/garmin
//   GET  /webhooks/fitbit    (Fitbit verification challenge)
//   POST /webhooks/fitbit
// ---------------------------------------------------------------------------
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { enqueueWebhookSync } from "../jobs/queue.js";
import { captureRawBody, verifyGarminSignature, verifyFitbitSignature } from "../middleware/webhook-verify.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// ── Garmin webhook payload shapes ──────────────────────────────────────────
interface GarminWebhookPayload {
  activities?:     Array<{ userId: string }>;
  activityDetails?: Array<{ userId: string }>;
  dailies?:        Array<{ userId: string }>;
  epochs?:         Array<{ userId: string }>;
  sleeps?:         Array<{ userId: string }>;
  bodyComps?:      Array<{ userId: string }>;
  stressDetails?:  Array<{ userId: string }>;
  userMetrics?:    Array<{ userId: string }>;
  moveIQ?:         Array<{ userId: string }>;
  pulseOx?:        Array<{ userId: string }>;
  respiration?:    Array<{ userId: string }>;
  hrv?:            Array<{ userId: string }>;
}

// ── Fitbit webhook payload shape ───────────────────────────────────────────
interface FitbitNotification {
  collectionType: string;
  date: string;
  ownerId: string;
  ownerType: string;
  subscriptionId: string;
}

export const webhooksRouter = Router();

// Garmin — POST /webhooks/garmin
webhooksRouter.post("/garmin", captureRawBody, verifyGarminSignature, async (req, res, next) => {
  try {
    const payload = req.body as GarminWebhookPayload;
    const userIdSet = new Set<string>();
    const keys: Array<keyof GarminWebhookPayload> = [
      "activities", "activityDetails", "dailies", "epochs",
      "sleeps", "bodyComps", "stressDetails", "userMetrics",
      "moveIQ", "pulseOx", "respiration", "hrv",
    ];
    for (const k of keys) for (const item of payload[k] ?? []) if (item.userId) userIdSet.add(item.userId);

    if (!userIdSet.size) return res.status(200).json({ received: true, queued: 0 });

    let queued = 0;
    for (const providerUserId of userIdSet) {
      const conn = await prisma.wearableConnection.findFirst({
        where: { provider: "garmin", providerUserId, status: "active" },
        select: { userId: true },
      });
      if (!conn) { logger.warn({ providerUserId }, "Garmin webhook: no connection"); continue; }
      await enqueueWebhookSync(conn.userId, "garmin");
      queued++;
    }

    logger.info({ users: userIdSet.size, queued }, "Garmin webhook processed");
    return res.status(200).json({ received: true, queued });
  } catch (error) { return next(error); }
});

// Fitbit — GET /webhooks/fitbit (verification challenge)
webhooksRouter.get("/fitbit", (req, res) => {
  const { verify } = req.query;
  if (!verify || typeof verify !== "string") return res.status(404).json({ error: "Not found" });
  return verify === env.FITBIT_WEBHOOK_SUBSCRIBER_CODE ? res.status(204).send() : res.status(404).send();
});

// Fitbit — POST /webhooks/fitbit
webhooksRouter.post("/fitbit", captureRawBody, verifyFitbitSignature, async (req, res, next) => {
  try {
    const notifications = req.body as FitbitNotification[];
    if (!Array.isArray(notifications) || !notifications.length) return res.status(204).send();

    const byOwner = new Set(notifications.map((n) => n.ownerId));
    let queued = 0;

    for (const providerUserId of byOwner) {
      const conn = await prisma.wearableConnection.findFirst({
        where: { provider: "fitbit", providerUserId, status: "active" },
        select: { userId: true },
      });
      if (!conn) { logger.warn({ providerUserId }, "Fitbit webhook: no connection"); continue; }
      await enqueueWebhookSync(conn.userId, "fitbit");
      queued++;
    }

    logger.info({ total: notifications.length, queued }, "Fitbit webhook processed");
    return res.status(204).send();
  } catch (error) { return next(error); }
});

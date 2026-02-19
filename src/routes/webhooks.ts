// ---------------------------------------------------------------------------
// Webhook routes — incoming push notifications from Garmin and Fitbit
//
//   POST /webhooks/garmin
//   GET  /webhooks/fitbit    (Fitbit verification challenge)
//   POST /webhooks/fitbit
// ---------------------------------------------------------------------------
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { JOBS, getBoss } from "../jobs/queue.js";
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

// ---------------------------------------------------------------------------
// Garmin — POST /webhooks/garmin
// ---------------------------------------------------------------------------
webhooksRouter.post(
  "/garmin",
  captureRawBody,
  verifyGarminSignature,
  async (req, res, next) => {
    try {
      const payload = req.body as GarminWebhookPayload;

      // Collect all unique userIds mentioned in this payload
      const userIdSet = new Set<string>();
      const dataTypes: Array<keyof GarminWebhookPayload> = [
        "activities", "activityDetails", "dailies", "epochs",
        "sleeps", "bodyComps", "stressDetails", "userMetrics",
        "moveIQ", "pulseOx", "respiration", "hrv",
      ];

      for (const dtype of dataTypes) {
        for (const item of payload[dtype] ?? []) {
          if (item.userId) userIdSet.add(item.userId);
        }
      }

      if (userIdSet.size === 0) {
        return res.status(200).json({ received: true, queued: 0 });
      }

      const boss = await getBoss();
      let queued = 0;

      for (const providerUserId of userIdSet) {
        // Look up our internal user by providerUserId
        const connection = await prisma.wearableConnection.findFirst({
          where: { provider: "garmin", providerUserId, status: "active" },
          select: { userId: true },
        });

        if (!connection) {
          logger.warn({ providerUserId }, "Garmin webhook: no active connection found");
          continue;
        }

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

        await boss.send(JOBS.SYNC, {
          userId: connection.userId,
          provider: "garmin",
          startDate: yesterday,
          endDate: today,
        });
        queued++;
      }

      logger.info({ userCount: userIdSet.size, queued }, "Garmin webhook processed");
      return res.status(200).json({ received: true, queued });
    } catch (error) {
      return next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Fitbit — GET /webhooks/fitbit  (one-time verification challenge)
// ---------------------------------------------------------------------------
webhooksRouter.get("/fitbit", (req, res) => {
  const { verify } = req.query;
  if (!verify || typeof verify !== "string") {
    return res.status(404).json({ error: "Not found" });
  }

  // Fitbit sends the subscriber verification code; respond with 204 if it matches
  if (verify === env.FITBIT_WEBHOOK_SUBSCRIBER_CODE) {
    return res.status(204).send();
  }

  return res.status(404).send();
});

// ---------------------------------------------------------------------------
// Fitbit — POST /webhooks/fitbit
// ---------------------------------------------------------------------------
webhooksRouter.post(
  "/fitbit",
  captureRawBody,
  verifyFitbitSignature,
  async (req, res, next) => {
    try {
      const notifications = req.body as FitbitNotification[];

      if (!Array.isArray(notifications) || notifications.length === 0) {
        return res.status(204).send();
      }

      const boss = await getBoss();
      let queued = 0;

      // Group by ownerId to batch
      const byOwner = new Map<string, FitbitNotification[]>();
      for (const n of notifications) {
        const list = byOwner.get(n.ownerId) ?? [];
        list.push(n);
        byOwner.set(n.ownerId, list);
      }

      for (const [providerUserId] of byOwner) {
        const connection = await prisma.wearableConnection.findFirst({
          where: { provider: "fitbit", providerUserId, status: "active" },
          select: { userId: true },
        });

        if (!connection) {
          logger.warn({ providerUserId }, "Fitbit webhook: no active connection found");
          continue;
        }

        const today = new Date().toISOString().slice(0, 10);
        const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

        await boss.send(JOBS.SYNC, {
          userId: connection.userId,
          provider: "fitbit",
          startDate: twoDaysAgo,
          endDate: today,
        });
        queued++;
      }

      logger.info({ total: notifications.length, queued }, "Fitbit webhook processed");
      // Fitbit expects 204
      return res.status(204).send();
    } catch (error) {
      return next(error);
    }
  },
);

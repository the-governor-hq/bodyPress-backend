// ---------------------------------------------------------------------------
// Webhook routes — incoming push notifications from Garmin and Fitbit
//
// Garmin push payloads contain full summary data — we normalize and store them
// directly (no pull API call needed).  A fallback pull-based sync is still
// enqueued so that if push data is partial the scheduler can back-fill.
//
//   POST /webhooks/garmin
//   GET  /webhooks/fitbit    (Fitbit verification challenge)
//   POST /webhooks/fitbit
// ---------------------------------------------------------------------------
import { Router } from "express";
import type {
  NormalizedActivity,
  NormalizedSleep,
  NormalizedDaily,
} from "@the-governor-hq/wearable-sdk";
import type {
  GarminRawActivity,
  GarminRawSleep,
  GarminRawDaily,
} from "@the-governor-hq/wearable-sdk/garmin";
import { prisma } from "../db/prisma.js";
import { enqueueWebhookSync } from "../jobs/queue.js";
import { saveSnapshot } from "../services/wearable-storage.service.js";
import { captureRawBody, verifyGarminSignature, verifyFitbitSignature } from "../middleware/webhook-verify.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// ── Garmin webhook payload shapes ──────────────────────────────────────────
// Garmin push payloads deliver the FULL raw summaries — same schema the pull
// API returns — plus a top-level `userId` string on every item.
type WithUserId<T> = T & { userId: string };

interface GarminWebhookPayload {
  activities?:      WithUserId<GarminRawActivity>[];
  activityDetails?: WithUserId<GarminRawActivity>[];
  dailies?:         WithUserId<GarminRawDaily>[];
  epochs?:          Array<{ userId: string; [k: string]: unknown }>;
  sleeps?:          WithUserId<GarminRawSleep>[];
  bodyComps?:       Array<{ userId: string; [k: string]: unknown }>;
  stressDetails?:   Array<{ userId: string; [k: string]: unknown }>;
  userMetrics?:     Array<{ userId: string; [k: string]: unknown }>;
  moveIQ?:          Array<{ userId: string; [k: string]: unknown }>;
  pulseOx?:         Array<{ userId: string; [k: string]: unknown }>;
  respiration?:     Array<{ userId: string; [k: string]: unknown }>;
  hrv?:             Array<{ userId: string; [k: string]: unknown }>;
}

// ── Garmin raw → normalized helpers ────────────────────────────────────────
// Mirrors the SDK's GarminProvider normalization so we can persist push data
// without instantiating a full provider or needing pull permission.

const ACTIVITY_TYPE_MAP: Record<string, string> = {
  RUNNING: "run", CYCLING: "bike", SWIMMING: "swim", WALKING: "walk",
  HIKING: "hike", STRENGTH_TRAINING: "strength", YOGA: "yoga",
  INDOOR_CYCLING: "bike_indoor", TREADMILL_RUNNING: "run_indoor",
  ELLIPTICAL: "elliptical",
};

function normalizeGarminActivity(raw: GarminRawActivity): NormalizedActivity {
  return {
    id: String(raw.activityId),
    provider: "garmin",
    type: ACTIVITY_TYPE_MAP[raw.activityType] ?? raw.activityType.toLowerCase(),
    startTime: new Date(raw.startTimeInSeconds * 1000).toISOString(),
    endTime: new Date((raw.startTimeInSeconds + raw.durationInSeconds) * 1000).toISOString(),
    durationSeconds: raw.durationInSeconds,
    calories: raw.activeKilocalories ?? undefined,
    distanceMeters: raw.distanceInMeters ?? undefined,
    steps: raw.steps ?? undefined,
    averageHeartRate: raw.averageHeartRateInBeatsPerMinute ?? undefined,
    maxHeartRate: raw.maxHeartRateInBeatsPerMinute ?? undefined,
    source: raw.deviceName ?? "garmin",
    raw,
  };
}

const SLEEP_STAGE_MAP: Record<string, string> = {
  deep: "deep", light: "light", rem: "rem", awake: "awake",
};

function normalizeGarminSleep(raw: GarminRawSleep): NormalizedSleep {
  const stages: Array<{ stage: string; startTime: string; endTime: string; durationSeconds: number }> = [];
  if (raw.sleepLevelsMap) {
    for (const [level, periods] of Object.entries(raw.sleepLevelsMap)) {
      for (const p of periods) {
        stages.push({
          stage: SLEEP_STAGE_MAP[level.toLowerCase()] ?? level.toLowerCase(),
          startTime: new Date(p.startTimeInSeconds * 1000).toISOString(),
          endTime: new Date(p.endTimeInSeconds * 1000).toISOString(),
          durationSeconds: p.endTimeInSeconds - p.startTimeInSeconds,
        });
      }
    }
    stages.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  }
  return {
    id: raw.summaryId ?? raw.calendarDate,
    provider: "garmin",
    date: raw.calendarDate,
    startTime: new Date(raw.startTimeInSeconds * 1000).toISOString(),
    endTime: new Date((raw.startTimeInSeconds + raw.durationInSeconds) * 1000).toISOString(),
    durationSeconds: raw.durationInSeconds,
    deepSleepSeconds: raw.deepSleepDurationInSeconds ?? undefined,
    lightSleepSeconds: raw.lightSleepDurationInSeconds ?? undefined,
    remSleepSeconds: raw.remSleepInSeconds ?? undefined,
    awakeSeconds: raw.awakeDurationInSeconds ?? undefined,
    sleepScore: raw.overallSleepScore?.value ?? undefined,
    stages: stages.length > 0 ? stages : undefined,
    raw,
  };
}

function normalizeGarminDaily(raw: GarminRawDaily): NormalizedDaily {
  return {
    id: raw.summaryId ?? raw.calendarDate,
    provider: "garmin",
    date: raw.calendarDate,
    steps: raw.steps ?? undefined,
    calories: raw.activeKilocalories ?? undefined,
    distanceMeters: raw.distanceInMeters ?? undefined,
    activeMinutes: raw.activeTimeInSeconds != null ? Math.floor(raw.activeTimeInSeconds / 60) : undefined,
    restingHeartRate: raw.restingHeartRateInBeatsPerMinute ?? undefined,
    averageHeartRate: raw.averageHeartRateInBeatsPerMinute ?? undefined,
    maxHeartRate: raw.maxHeartRateInBeatsPerMinute ?? undefined,
    stressLevel: raw.averageStressLevel ?? undefined,
    floorsClimbed: raw.floorsClimbed ?? undefined,
    raw,
  };
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

// ── Garmin — POST /webhooks/garmin ──────────────────────────────────────────
// Strategy:
//   1. Normalize any activities / dailies / sleeps from the push payload.
//   2. Group by Garmin userId → look up internal userId.
//   3. Persist the data directly via saveSnapshot (no pull needed).
//   4. Enqueue a fallback pull-based sync job for completeness.
webhooksRouter.post("/garmin", captureRawBody, verifyGarminSignature, async (req, res, next) => {
  try {
    const payload = req.body as GarminWebhookPayload;

    // All push payload arrays carry a top-level `userId` (Garmin user ID string).
    const ALL_KEYS: Array<keyof GarminWebhookPayload> = [
      "activities", "activityDetails", "dailies", "epochs",
      "sleeps", "bodyComps", "stressDetails", "userMetrics",
      "moveIQ", "pulseOx", "respiration", "hrv",
    ];

    // Collect unique Garmin user IDs
    const userIdSet = new Set<string>();
    for (const k of ALL_KEYS) {
      for (const item of (payload[k] ?? []) as Array<{ userId: string }>) {
        if (item.userId) userIdSet.add(item.userId);
      }
    }

    if (!userIdSet.size) return res.status(200).json({ received: true, stored: 0, queued: 0 });

    let stored = 0;
    let queued = 0;

    for (const providerUserId of userIdSet) {
      const conn = await prisma.wearableConnection.findFirst({
        where: { provider: "garmin", providerUserId, status: "active" },
        select: { userId: true },
      });
      if (!conn) {
        logger.warn({ providerUserId }, "Garmin webhook: no connection");
        continue;
      }

      // ─ Normalize push data for this Garmin user ───────────────────────────
      const activities: NormalizedActivity[] = [
        ...(payload.activities ?? []),
        ...(payload.activityDetails ?? []),
      ]
        .filter((a) => a.userId === providerUserId)
        .map(normalizeGarminActivity);

      const sleep: NormalizedSleep[] = (payload.sleeps ?? [])
        .filter((s) => s.userId === providerUserId)
        .map(normalizeGarminSleep);

      const dailies: NormalizedDaily[] = (payload.dailies ?? [])
        .filter((d) => d.userId === providerUserId)
        .map(normalizeGarminDaily);

      const hasData = activities.length + sleep.length + dailies.length > 0;

      // ─ Persist directly from push ─────────────────────────────────────────
      if (hasData) {
        await saveSnapshot({
          userId: conn.userId,
          provider: "garmin",
          activities,
          sleep,
          dailies,
        });
        stored++;
        logger.info(
          { userId: conn.userId, activities: activities.length, sleep: sleep.length, dailies: dailies.length },
          "Garmin push data stored",
        );
      }

      // ─ Fallback: enqueue a pull-based sync (gracefully skipped if no pull permission)
      await enqueueWebhookSync(conn.userId, "garmin");
      queued++;
    }

    logger.info({ users: userIdSet.size, stored, queued }, "Garmin webhook processed");
    return res.status(200).json({ received: true, stored, queued });
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

// ---------------------------------------------------------------------------
// Wearable data read routes — authenticated endpoints to query stored data
//
//   GET /v1/wearables/activities?provider=&startDate=&endDate=&limit=&cursor=
//   GET /v1/wearables/sleep?provider=&startDate=&endDate=&limit=&cursor=
//   GET /v1/wearables/dailies?provider=&startDate=&endDate=&limit=&cursor=
//   GET /v1/wearables/summary?provider=&days=
//   GET /v1/wearables/connections
//
// (backfill and sync routes are already in wearables.ts, these are additive)
// ---------------------------------------------------------------------------
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";

const dateRangeSchema = z.object({
  provider: z.enum(["garmin", "fitbit"]).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(), // last record id for keyset pagination
});

const summarySchema = z.object({
  provider: z.enum(["garmin", "fitbit"]).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const dataRouter = Router();

// GET /v1/wearables/activities
dataRouter.get("/activities", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const q = dateRangeSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });

    const { provider, startDate, endDate, limit, cursor } = q.data;

    const where: Record<string, unknown> = { userId };
    if (provider) where.provider = provider;
    if (startDate) where.startTime = { ...(where.startTime as object ?? {}), gte: new Date(startDate) };
    if (endDate) where.startTime = { ...(where.startTime as object ?? {}), lte: new Date(`${endDate}T23:59:59Z`) };
    if (cursor) where.id = { gt: cursor };

    const activities = await prisma.wearableActivity.findMany({
      where,
      orderBy: { startTime: "desc" },
      take: limit + 1,
      select: {
        id: true, provider: true, type: true,
        startTime: true, endTime: true, durationSeconds: true,
        calories: true, distanceMeters: true, steps: true,
        averageHeartRate: true, maxHeartRate: true, source: true,
        syncedAt: true,
      },
    });

    const hasMore = activities.length > limit;
    if (hasMore) activities.pop();

    return res.status(200).json({
      data: activities,
      pagination: {
        hasMore,
        nextCursor: hasMore ? activities[activities.length - 1]?.id : null,
        count: activities.length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /v1/wearables/sleep
dataRouter.get("/sleep", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const q = dateRangeSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });

    const { provider, startDate, endDate, limit, cursor } = q.data;

    const where: Record<string, unknown> = { userId };
    if (provider) where.provider = provider;
    if (startDate) where.date = { ...(where.date as object ?? {}), gte: startDate };
    if (endDate) where.date = { ...(where.date as object ?? {}), lte: endDate };
    if (cursor) where.id = { gt: cursor };

    const sleep = await prisma.wearableSleep.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit + 1,
      select: {
        id: true, provider: true, date: true,
        startTime: true, endTime: true, durationSeconds: true,
        deepSleepSeconds: true, lightSleepSeconds: true,
        remSleepSeconds: true, awakeSeconds: true, sleepScore: true,
        syncedAt: true,
      },
    });

    const hasMore = sleep.length > limit;
    if (hasMore) sleep.pop();

    return res.status(200).json({
      data: sleep,
      pagination: {
        hasMore,
        nextCursor: hasMore ? sleep[sleep.length - 1]?.id : null,
        count: sleep.length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /v1/wearables/dailies
dataRouter.get("/dailies", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const q = dateRangeSchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });

    const { provider, startDate, endDate, limit, cursor } = q.data;

    const where: Record<string, unknown> = { userId };
    if (provider) where.provider = provider;
    if (startDate) where.date = { ...(where.date as object ?? {}), gte: startDate };
    if (endDate) where.date = { ...(where.date as object ?? {}), lte: endDate };
    if (cursor) where.id = { gt: cursor };

    const dailies = await prisma.wearableDaily.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit + 1,
      select: {
        id: true, provider: true, date: true,
        steps: true, calories: true, distanceMeters: true,
        activeMinutes: true, restingHeartRate: true,
        averageHeartRate: true, maxHeartRate: true,
        stressLevel: true, floorsClimbed: true,
        syncedAt: true,
      },
    });

    const hasMore = dailies.length > limit;
    if (hasMore) dailies.pop();

    return res.status(200).json({
      data: dailies,
      pagination: {
        hasMore,
        nextCursor: hasMore ? dailies[dailies.length - 1]?.id : null,
        count: dailies.length,
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /v1/wearables/summary  — aggregated stats for N days
dataRouter.get("/summary", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const q = summarySchema.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });

    const { provider, days } = q.data;
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const providerFilter = provider ? { provider } : {};

    const [activities, sleep, dailies, connections] = await Promise.all([
      prisma.wearableActivity.aggregate({
        where: { userId, ...providerFilter, startTime: { gte: since } },
        _count: { id: true },
        _sum: { durationSeconds: true, calories: true, distanceMeters: true, steps: true },
        _avg: { averageHeartRate: true },
      }),
      prisma.wearableSleep.aggregate({
        where: { userId, ...providerFilter, date: { gte: sinceStr } },
        _count: { id: true },
        _avg: {
          durationSeconds: true, deepSleepSeconds: true,
          lightSleepSeconds: true, remSleepSeconds: true, sleepScore: true,
        },
      }),
      prisma.wearableDaily.aggregate({
        where: { userId, ...providerFilter, date: { gte: sinceStr } },
        _count: { id: true },
        _avg: {
          steps: true, calories: true, activeMinutes: true,
          restingHeartRate: true, stressLevel: true,
        },
        _sum: { steps: true, calories: true },
      }),
      wearableSdk.getConnectionHealthAll(userId),
    ]);

    return res.status(200).json({
      period: { days, since: sinceStr, until: new Date().toISOString().slice(0, 10) },
      activities: {
        count: activities._count.id,
        totalDurationHours: ((activities._sum.durationSeconds ?? 0) / 3600).toFixed(1),
        totalCalories: activities._sum.calories ?? 0,
        totalDistanceKm: (((activities._sum.distanceMeters ?? 0) / 1000)).toFixed(2),
        totalSteps: activities._sum.steps ?? 0,
        avgHeartRate: activities._avg.averageHeartRate ?? null,
      },
      sleep: {
        nights: sleep._count.id,
        avgDurationHours: sleep._avg.durationSeconds
          ? (sleep._avg.durationSeconds / 3600).toFixed(1)
          : null,
        avgDeepSleepMins: sleep._avg.deepSleepSeconds
          ? Math.round(sleep._avg.deepSleepSeconds / 60)
          : null,
        avgRemSleepMins: sleep._avg.remSleepSeconds
          ? Math.round(sleep._avg.remSleepSeconds / 60)
          : null,
        avgSleepScore: sleep._avg.sleepScore
          ? Math.round(sleep._avg.sleepScore)
          : null,
      },
      daily: {
        days: dailies._count.id,
        avgSteps: dailies._avg.steps ? Math.round(dailies._avg.steps) : null,
        totalSteps: dailies._sum.steps ?? 0,
        avgCalories: dailies._avg.calories ? Math.round(dailies._avg.calories) : null,
        avgActiveMinutes: dailies._avg.activeMinutes ? Math.round(dailies._avg.activeMinutes) : null,
        avgRestingHeartRate: dailies._avg.restingHeartRate
          ? Math.round(dailies._avg.restingHeartRate)
          : null,
        avgStressLevel: dailies._avg.stressLevel ? Math.round(dailies._avg.stressLevel) : null,
      },
      connections,
    });
  } catch (error) {
    return next(error);
  }
});

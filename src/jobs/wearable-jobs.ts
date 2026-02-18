import type PgBoss from "pg-boss";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { parseProvider } from "../lib/provider.js";
import { logger } from "../lib/logger.js";
import { JOBS } from "./queue.js";
import { saveSnapshot } from "../services/wearable-storage.service.js";

type BackfillJobData = {
  userId: string;
  provider: string;
  daysBack?: number;
};

type SyncJobData = {
  userId: string;
  provider: string;
  startDate?: string;
  endDate?: string;
};

function getJobData<T>(job: { data?: unknown } | Array<{ data?: unknown }>): T {
  if (Array.isArray(job)) {
    return (job[0]?.data ?? {}) as T;
  }

  return (job.data ?? {}) as T;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultSyncWindow(lastSyncedAt?: Date | null) {
  const end = new Date();
  const start = new Date(lastSyncedAt ?? end);
  start.setDate(start.getDate() - 2);

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
  };
}

export async function registerWearableJobs(boss: PgBoss) {
  await boss.work(JOBS.BACKFILL, async (job) => {
    const data = getJobData<BackfillJobData>(job);
    const provider = parseProvider(data.provider);

    if (!provider) {
      throw new Error(`Unsupported provider in backfill job: ${data.provider}`);
    }

    const snapshot = await wearableSdk.backfill(provider, {
      userId: data.userId,
      daysBack: data.daysBack ?? 60,
    });

    await saveSnapshot({
      userId: data.userId,
      provider,
      activities: snapshot.activities,
      sleep: snapshot.sleep,
      dailies: snapshot.dailies,
    });

    logger.info({ userId: data.userId, provider }, "Backfill job completed");
  });

  await boss.work(JOBS.SYNC, async (job) => {
    const data = getJobData<SyncJobData>(job);
    const provider = parseProvider(data.provider);

    if (!provider) {
      throw new Error(`Unsupported provider in sync job: ${data.provider}`);
    }

    const connection = await prisma.wearableConnection.findUnique({
      where: { userId_provider: { userId: data.userId, provider } },
      select: { lastSyncedAt: true },
    });

    const range = {
      ...(connection ? defaultSyncWindow(connection.lastSyncedAt) : defaultSyncWindow()),
      ...(data.startDate ? { startDate: data.startDate } : {}),
      ...(data.endDate ? { endDate: data.endDate } : {}),
    };

    const [activities, sleep, dailies] = await Promise.all([
      wearableSdk.getActivities(provider, {
        userId: data.userId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
      wearableSdk.getSleep(provider, {
        userId: data.userId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
      wearableSdk.getDailies(provider, {
        userId: data.userId,
        startDate: range.startDate,
        endDate: range.endDate,
      }),
    ]);

    await saveSnapshot({
      userId: data.userId,
      provider,
      activities,
      sleep,
      dailies,
    });

    logger.info(
      {
        userId: data.userId,
        provider,
        activities: activities.length,
        sleep: sleep.length,
        dailies: dailies.length,
      },
      "Daily sync job completed",
    );
  });

  await boss.work(JOBS.DAILY_FANOUT, async () => {
    const connections = await prisma.wearableConnection.findMany({
      where: { status: "active" },
      select: { userId: true, provider: true },
    });

    if (!connections.length) {
      return;
    }

    for (const connection of connections) {
      await boss.send(JOBS.SYNC, {
        userId: connection.userId,
        provider: connection.provider,
      });
    }

    logger.info({ count: connections.length }, "Scheduled sync jobs for active connections");
  });

  await boss.schedule(JOBS.DAILY_FANOUT, env.SYNC_CRON, {});
  logger.info({ cron: env.SYNC_CRON }, "Daily fanout schedule registered");
}

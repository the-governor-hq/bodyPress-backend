import type { Prisma } from "../generated/prisma/client.js";
import type {
  NormalizedActivity,
  NormalizedDaily,
  NormalizedSleep,
  ProviderName,
} from "@the-governor-hq/wearable-sdk";
import { prisma } from "../db/prisma.js";

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function saveActivities(
  userId: string,
  provider: ProviderName,
  activities: NormalizedActivity[],
) {
  for (const activity of activities) {
    await prisma.wearableRawIngest.upsert({
      where: {
        uniq_ingest_source: {
          userId,
          provider,
          dataType: "activity",
          sourceId: activity.id,
        },
      },
      create: {
        userId,
        provider,
        dataType: "activity",
        sourceId: activity.id,
        observedDate: activity.startTime.slice(0, 10),
        payload: asJson(activity.raw),
      },
      update: {
        observedDate: activity.startTime.slice(0, 10),
        payload: asJson(activity.raw),
        fetchedAt: new Date(),
      },
    });

    await prisma.wearableActivity.upsert({
      where: {
        uniq_activity_external: {
          userId,
          provider,
          externalId: activity.id,
        },
      },
      create: {
        userId,
        provider,
        externalId: activity.id,
        type: activity.type,
        startTime: new Date(activity.startTime),
        endTime: new Date(activity.endTime),
        durationSeconds: activity.durationSeconds,
        calories: activity.calories,
        distanceMeters: activity.distanceMeters,
        steps: activity.steps,
        averageHeartRate: activity.averageHeartRate,
        maxHeartRate: activity.maxHeartRate,
        source: activity.source,
        raw: asJson(activity.raw),
      },
      update: {
        type: activity.type,
        startTime: new Date(activity.startTime),
        endTime: new Date(activity.endTime),
        durationSeconds: activity.durationSeconds,
        calories: activity.calories,
        distanceMeters: activity.distanceMeters,
        steps: activity.steps,
        averageHeartRate: activity.averageHeartRate,
        maxHeartRate: activity.maxHeartRate,
        source: activity.source,
        raw: asJson(activity.raw),
        syncedAt: new Date(),
      },
    });
  }
}

export async function saveSleep(userId: string, provider: ProviderName, sleep: NormalizedSleep[]) {
  for (const entry of sleep) {
    await prisma.wearableRawIngest.upsert({
      where: {
        uniq_ingest_source: {
          userId,
          provider,
          dataType: "sleep",
          sourceId: entry.id,
        },
      },
      create: {
        userId,
        provider,
        dataType: "sleep",
        sourceId: entry.id,
        observedDate: entry.date,
        payload: asJson(entry.raw),
      },
      update: {
        observedDate: entry.date,
        payload: asJson(entry.raw),
        fetchedAt: new Date(),
      },
    });

    await prisma.wearableSleep.upsert({
      where: {
        uniq_sleep_external: {
          userId,
          provider,
          externalId: entry.id,
        },
      },
      create: {
        userId,
        provider,
        externalId: entry.id,
        date: entry.date,
        startTime: new Date(entry.startTime),
        endTime: new Date(entry.endTime),
        durationSeconds: entry.durationSeconds,
        deepSleepSeconds: entry.deepSleepSeconds,
        lightSleepSeconds: entry.lightSleepSeconds,
        remSleepSeconds: entry.remSleepSeconds,
        awakeSeconds: entry.awakeSeconds,
        sleepScore: entry.sleepScore,
        stages: asJson(entry.stages),
        raw: asJson(entry.raw),
      },
      update: {
        date: entry.date,
        startTime: new Date(entry.startTime),
        endTime: new Date(entry.endTime),
        durationSeconds: entry.durationSeconds,
        deepSleepSeconds: entry.deepSleepSeconds,
        lightSleepSeconds: entry.lightSleepSeconds,
        remSleepSeconds: entry.remSleepSeconds,
        awakeSeconds: entry.awakeSeconds,
        sleepScore: entry.sleepScore,
        stages: asJson(entry.stages),
        raw: asJson(entry.raw),
        syncedAt: new Date(),
      },
    });
  }
}

export async function saveDailies(
  userId: string,
  provider: ProviderName,
  dailies: NormalizedDaily[],
) {
  for (const daily of dailies) {
    await prisma.wearableRawIngest.upsert({
      where: {
        uniq_ingest_source: {
          userId,
          provider,
          dataType: "daily",
          sourceId: daily.id,
        },
      },
      create: {
        userId,
        provider,
        dataType: "daily",
        sourceId: daily.id,
        observedDate: daily.date,
        payload: asJson(daily.raw),
      },
      update: {
        observedDate: daily.date,
        payload: asJson(daily.raw),
        fetchedAt: new Date(),
      },
    });

    await prisma.wearableDaily.upsert({
      where: {
        uniq_daily_date: {
          userId,
          provider,
          date: daily.date,
        },
      },
      create: {
        userId,
        provider,
        date: daily.date,
        externalId: daily.id,
        steps: daily.steps,
        calories: daily.calories,
        distanceMeters: daily.distanceMeters,
        activeMinutes: daily.activeMinutes,
        restingHeartRate: daily.restingHeartRate,
        averageHeartRate: daily.averageHeartRate,
        maxHeartRate: daily.maxHeartRate,
        stressLevel: daily.stressLevel,
        floorsClimbed: daily.floorsClimbed,
        raw: asJson(daily.raw),
      },
      update: {
        externalId: daily.id,
        steps: daily.steps,
        calories: daily.calories,
        distanceMeters: daily.distanceMeters,
        activeMinutes: daily.activeMinutes,
        restingHeartRate: daily.restingHeartRate,
        averageHeartRate: daily.averageHeartRate,
        maxHeartRate: daily.maxHeartRate,
        stressLevel: daily.stressLevel,
        floorsClimbed: daily.floorsClimbed,
        raw: asJson(daily.raw),
        syncedAt: new Date(),
      },
    });
  }
}

export async function saveSnapshot(input: {
  userId: string;
  provider: ProviderName;
  activities: NormalizedActivity[];
  sleep: NormalizedSleep[];
  dailies: NormalizedDaily[];
}) {
  await saveActivities(input.userId, input.provider, input.activities);
  await saveSleep(input.userId, input.provider, input.sleep);
  await saveDailies(input.userId, input.provider, input.dailies);

  await prisma.wearableConnection.updateMany({
    where: { userId: input.userId, provider: input.provider },
    data: { lastSyncedAt: new Date(), status: "active" },
  });
}

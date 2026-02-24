// ---------------------------------------------------------------------------
// Wearable job processor — polls sync_jobs table, processes, marks done.
// Scheduled via node-cron (no PG Boss).
// ---------------------------------------------------------------------------
import cron from "node-cron";
import { env } from "../config/env.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { parseProvider } from "../lib/provider.js";
import { logger } from "../lib/logger.js";
import { saveSnapshot } from "../services/wearable-storage.service.js";
import {
  claimJobs,
  markDone,
  markFailed,
  fanoutDailySync,
  type ClaimedJob,
} from "./queue.js";

// ── Garmin 24-hour window chunking ────────────────────────────────────────
// The Garmin Wellness API rejects requests where
// uploadEndTimeInSeconds − uploadStartTimeInSeconds ≥ 86 400 (24 h).
// We split wider date ranges into < 24-hour chunks before calling the SDK.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Split a date range into chunks that are strictly < 24 hours each.
 *
 * Returns ISO-8601 timestamps (not bare dates) so the SDK preserves
 * sub-day precision when converting to epoch seconds.  Each chunk's end
 * is 1 s before the next chunk's start, keeping every window at 86 399 s.
 */
function chunkDateRange(
  startDate: string,
  endDate: string,
): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let cursor = new Date(startDate);
  const end = new Date(endDate);

  while (cursor < end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + ONE_DAY_MS, end.getTime()),
    );
    // Subtract 1 s when the window would hit exactly 24 h
    const delta = chunkEnd.getTime() - cursor.getTime();
    const safeEnd =
      delta >= ONE_DAY_MS ? new Date(chunkEnd.getTime() - 1_000) : chunkEnd;

    chunks.push([cursor.toISOString(), safeEnd.toISOString()]);
    cursor = chunkEnd; // next chunk starts at the un-adjusted boundary
  }

  // startDate === endDate → zero-width window → nothing to query
  return chunks;
}

let processing = false;

async function processJob(job: ClaimedJob) {
  const provider = parseProvider(job.provider);
  if (!provider) {
    await markFailed(job.id, `Unsupported provider: ${job.provider}`);
    return;
  }

  // Garmin enforces a max 24-hour query window — chunk wider ranges.
  // Other providers (Fitbit) handle their own limits internally.
  const needsChunking = provider === "garmin";
  const chunks = needsChunking
    ? chunkDateRange(job.startDate, job.endDate)
    : [[job.startDate, job.endDate] as [string, string]];

  const allActivities: Awaited<ReturnType<typeof wearableSdk.getActivities>>  = [];
  const allSleep:      Awaited<ReturnType<typeof wearableSdk.getSleep>>       = [];
  const allDailies:    Awaited<ReturnType<typeof wearableSdk.getDailies>>     = [];

  for (const [start, end] of chunks) {
    const [activities, sleep, dailies] = await Promise.all([
      wearableSdk.getActivities(provider, {
        userId: job.userId,
        startDate: start,
        endDate: end,
      }),
      wearableSdk.getSleep(provider, {
        userId: job.userId,
        startDate: start,
        endDate: end,
      }),
      wearableSdk.getDailies(provider, {
        userId: job.userId,
        startDate: start,
        endDate: end,
      }),
    ]);

    allActivities.push(...activities);
    allSleep.push(...sleep);
    allDailies.push(...dailies);
  }

  await saveSnapshot({
    userId: job.userId,
    provider,
    activities: allActivities,
    sleep: allSleep,
    dailies: allDailies,
  });

  await markDone(job.id);

  logger.info(
    {
      jobId: job.id,
      userId: job.userId,
      provider,
      type: job.jobType,
      chunks: chunks.length,
      activities: allActivities.length,
      sleep: allSleep.length,
      dailies: allDailies.length,
    },
    "Job processed",
  );
}

/**
 * Main loop: claim a batch, process each, repeat until queue is empty.
 * Guards against concurrent runs with the `processing` flag.
 */
async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    const batch = await claimJobs();

    for (const job of batch) {
      try {
        await processJob(job);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { jobId: job.id, userId: job.userId, provider: job.provider, attempt: job.attempts + 1, error: msg },
          "Job failed",
        );
        await markFailed(job.id, msg);
      }
    }
    // NOTE: We intentionally process only ONE batch per tick.
    // Failed-then-reset jobs need their backoff cooldown to elapse
    // before being claimed again (see claimJobs).
  } finally {
    processing = false;
  }
}

/**
 * Register cron schedules:
 *   1. Process queue every minute (picks up webhook-triggered & backfill jobs)
 *   2. Fanout daily sync for all active connections
 */
export function startJobScheduler() {
  // Process queue every minute
  cron.schedule("* * * * *", () => {
    processQueue().catch((err) =>
      logger.error({ error: err }, "Queue processor tick failed"),
    );
  });

  // Fanout: create sync jobs for stale connections
  cron.schedule(env.SYNC_CRON, () => {
    fanoutDailySync().catch((err) =>
      logger.error({ error: err }, "Daily fanout failed"),
    );
  });

  // Also run once on startup
  processQueue().catch((err) =>
    logger.error({ error: err }, "Initial queue drain failed"),
  );

  logger.info(
    { syncCron: env.SYNC_CRON },
    "Job scheduler started (DB-based queue)",
  );
}

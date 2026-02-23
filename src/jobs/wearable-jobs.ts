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

let processing = false;

async function processJob(job: ClaimedJob) {
  const provider = parseProvider(job.provider);
  if (!provider) {
    await markFailed(job.id, `Unsupported provider: ${job.provider}`);
    return;
  }

  const [activities, sleep, dailies] = await Promise.all([
    wearableSdk.getActivities(provider, {
      userId: job.userId,
      startDate: job.startDate,
      endDate: job.endDate,
    }),
    wearableSdk.getSleep(provider, {
      userId: job.userId,
      startDate: job.startDate,
      endDate: job.endDate,
    }),
    wearableSdk.getDailies(provider, {
      userId: job.userId,
      startDate: job.startDate,
      endDate: job.endDate,
    }),
  ]);

  await saveSnapshot({ userId: job.userId, provider, activities, sleep, dailies });

  await markDone(job.id);

  logger.info(
    {
      jobId: job.id,
      userId: job.userId,
      provider,
      type: job.jobType,
      activities: activities.length,
      sleep: sleep.length,
      dailies: dailies.length,
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
    let batch = await claimJobs();

    while (batch.length > 0) {
      for (const job of batch) {
        try {
          await processJob(job);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ jobId: job.id, error: msg }, "Job failed");
          await markFailed(job.id, msg);
        }
      }

      // Fetch next batch
      batch = await claimJobs();
    }
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

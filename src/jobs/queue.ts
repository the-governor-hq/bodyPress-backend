// ---------------------------------------------------------------------------
// Simple DB-based job queue — replaces PG Boss
//
// Pattern: insert rows into sync_jobs, poll for pending, process, mark done.
// ---------------------------------------------------------------------------
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";

const BATCH_SIZE = 100;

/** Format Date → "YYYY-MM-DD" */
export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Enqueue helpers ──────────────────────────────────────────────────────────

interface EnqueueInput {
  userId: string;
  provider: string;
  jobType: "sync" | "backfill";
  startDate: string;
  endDate: string;
  priority?: number;
}

export async function enqueueJob(input: EnqueueInput) {
  return prisma.syncJob.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      jobType: input.jobType,
      startDate: input.startDate,
      endDate: input.endDate,
      priority: input.priority ?? 0,
    },
  });
}

/**
 * Strategic enqueue after a device is paired:
 *   - Priority 10  → last 2 days   (processed first)
 *   - Priority 5   → days 3–14     (7-day windows)
 *   - Priority 1   → days 15–60    (7-day windows)
 *
 * This avoids hammering Garmin / Fitbit APIs all at once.
 */
export async function enqueueInitialSync(userId: string, provider: string) {
  const now = new Date();
  const jobs: EnqueueInput[] = [];

  // Immediate: last 2 days — high priority
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  jobs.push({
    userId,
    provider,
    jobType: "sync",
    startDate: fmtDate(twoDaysAgo),
    endDate: fmtDate(now),
    priority: 10,
  });

  // Medium: days 3–14, in 7-day windows
  for (let offset = 3; offset <= 14; offset += 7) {
    const end = new Date(now);
    end.setDate(end.getDate() - offset);
    const start = new Date(end);
    start.setDate(start.getDate() - Math.min(7, 14 - offset + 1));
    jobs.push({
      userId,
      provider,
      jobType: "backfill",
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      priority: 5,
    });
  }

  // Low: days 15–60, in 7-day windows
  for (let offset = 15; offset <= 60; offset += 7) {
    const end = new Date(now);
    end.setDate(end.getDate() - offset);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    jobs.push({
      userId,
      provider,
      jobType: "backfill",
      startDate: fmtDate(start),
      endDate: fmtDate(end),
      priority: 1,
    });
  }

  await prisma.syncJob.createMany({ data: jobs });

  logger.info(
    { userId, provider, count: jobs.length },
    "Initial sync jobs enqueued (2d immediate + strategic backfill)",
  );
}

/**
 * Enqueue a quick 2-day sync for a webhook push notification.
 * Deduplicates: if a pending/processing sync already covers this user+provider,
 * skip creating a duplicate to avoid redundant API calls & token refreshes.
 */
export async function enqueueWebhookSync(userId: string, provider: string) {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  // Deduplicate — skip if a recent pending/processing job already exists
  const existing = await prisma.syncJob.findFirst({
    where: {
      userId,
      provider,
      status: { in: ["pending", "processing"] },
    },
  });

  if (existing) {
    logger.debug(
      { userId, provider, existingJobId: existing.id },
      "Webhook sync skipped — pending job already exists",
    );
    return;
  }

  await enqueueJob({
    userId,
    provider,
    jobType: "sync",
    startDate: fmtDate(twoDaysAgo),
    endDate: fmtDate(now),
    priority: 8,
  });
}

// ── Poll & claim ─────────────────────────────────────────────────────────────

export interface ClaimedJob {
  id: string;
  userId: string;
  provider: string;
  jobType: string;
  startDate: string;
  endDate: string;
  attempts: number;
}

/**
 * Claim up to BATCH_SIZE pending jobs atomically.
 *
 * Uses DISTINCT ON ("userId", "provider") so that at most ONE job per
 * user+provider pair is claimed per batch.  This prevents concurrent token
 * refreshes / duplicate API calls even across multiple server instances —
 * the serialization lives in the DB, not in process memory.
 *
 * Retry backoff: jobs with attempts > 0 are not claimed until
 * (attempts × 5) minutes have elapsed since the last failure.
 */
export async function claimJobs(): Promise<ClaimedJob[]> {
  // Step 1 — pick the best candidate per user+provider
  //   Backoff: skip retried jobs whose cooldown hasn't elapsed.
  //   Brand-new jobs (attempts = 0) are always eligible.
  const candidates = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT DISTINCT ON ("userId", "provider") "id"
     FROM "sync_jobs"
     WHERE "status" = 'pending'
       AND "attempts" < 3
       AND ("attempts" = 0
            OR "updatedAt" < NOW() - ("attempts" * INTERVAL '5 minutes'))
     ORDER BY "userId", "provider", "priority" DESC, "createdAt" ASC
     LIMIT $1`,
    BATCH_SIZE,
  );

  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.id);

  // Step 2 — atomically flip to "processing" (only if still pending)
  await prisma.syncJob.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: { status: "processing" },
  });

  // Step 3 — return the claimed rows
  return prisma.syncJob.findMany({
    where: { id: { in: ids }, status: "processing" },
    select: {
      id: true,
      userId: true,
      provider: true,
      jobType: true,
      startDate: true,
      endDate: true,
      attempts: true,
    },
  });
}

/** Mark a job as done */
export async function markDone(jobId: string) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "done", processedAt: new Date() },
  });
}

/** Mark a job as failed (retried until maxAttempts) */
export async function markFailed(jobId: string, error: string) {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });

  const newAttempts = (job?.attempts ?? 0) + 1;
  const maxAttempts = job?.maxAttempts ?? 3;

  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: newAttempts >= maxAttempts ? "failed" : "pending",
      attempts: newAttempts,
      lastError: error,
    },
  });
}

// ── Scheduled fanout ─────────────────────────────────────────────────────────

/**
 * Create sync jobs for every active connection not synced in 30 min.
 *
 * Deduplicates: skips connections that already have a pending or processing
 * job — prevents flooding the queue when prior jobs are still retrying or
 * the API keeps returning errors.
 */
export async function fanoutDailySync() {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60_000);

  const connections = await prisma.wearableConnection.findMany({
    where: {
      status: "active",
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: thirtyMinAgo } }],
    },
    select: { userId: true, provider: true, lastSyncedAt: true },
  });

  if (!connections.length) return;

  // Deduplicate: find user+provider pairs that already have in-flight jobs
  const inflight = await prisma.syncJob.findMany({
    where: {
      status: { in: ["pending", "processing"] },
      userId: { in: connections.map((c) => c.userId) },
    },
    select: { userId: true, provider: true },
    distinct: ["userId", "provider"],
  });

  const inflightSet = new Set(inflight.map((j) => `${j.userId}::${j.provider}`));

  const now = new Date();
  const jobs = connections
    .filter((c) => !inflightSet.has(`${c.userId}::${c.provider}`))
    .map((c) => {
      const start = new Date(c.lastSyncedAt ?? now);
      start.setDate(start.getDate() - 2);
      return {
        userId: c.userId,
        provider: c.provider,
        jobType: "sync" as const,
        startDate: fmtDate(start),
        endDate: fmtDate(now),
        priority: 3,
      };
    });

  if (!jobs.length) {
    logger.debug("Daily fanout: all connections already have in-flight jobs");
    return;
  }

  await prisma.syncJob.createMany({ data: jobs });
  logger.info({ count: jobs.length }, "Daily fanout: created sync jobs");
}

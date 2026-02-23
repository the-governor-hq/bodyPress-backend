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
 */
export async function enqueueWebhookSync(userId: string, provider: string) {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

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
 */
export async function claimJobs(): Promise<ClaimedJob[]> {
  const candidates = await prisma.syncJob.findMany({
    where: {
      status: "pending",
      attempts: { lt: 3 },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: BATCH_SIZE,
    select: { id: true },
  });

  if (!candidates.length) return [];

  const ids = candidates.map((c) => c.id);

  await prisma.syncJob.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: { status: "processing" },
  });

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

  const now = new Date();
  const jobs = connections.map((c) => {
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

  await prisma.syncJob.createMany({ data: jobs });
  logger.info({ count: jobs.length }, "Daily fanout: created sync jobs");
}

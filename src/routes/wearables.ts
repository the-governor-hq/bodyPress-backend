// ---------------------------------------------------------------------------
// Wearable routes — compact write endpoints
//
//   POST /v1/wearables/sync          Trigger sync (all providers or specific)
//   GET  /v1/wearables/connections   List connections + health
// ---------------------------------------------------------------------------
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { enqueueJob, fmtDate } from "../jobs/queue.js";
import { parseProvider } from "../lib/provider.js";

const syncBody = z
  .object({
    provider: z.string().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .default({});

export const wearablesRouter = Router();

// POST /v1/wearables/sync — one endpoint to rule them all
wearablesRouter.post("/sync", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const body = syncBody.safeParse(req.body ?? {});
    if (!body.success) return res.status(400).json({ error: "Invalid body", details: body.error.flatten() });

    const { provider: rawProvider, startDate, endDate } = body.data;

    // Determine which providers to sync
    const providers = rawProvider
      ? [parseProvider(rawProvider)].filter(Boolean)
      : (
          await prisma.wearableConnection.findMany({
            where: { userId, status: "active" },
            select: { provider: true },
          })
        ).map((c) => parseProvider(c.provider)).filter(Boolean);

    if (!providers.length) return res.status(400).json({ error: "No active provider connections" });

    const now = new Date();
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    let queued = 0;
    for (const p of providers) {
      await enqueueJob({
        userId,
        provider: p!,
        jobType: "sync",
        startDate: startDate ?? fmtDate(twoDaysAgo),
        endDate: endDate ?? fmtDate(now),
        priority: 8,
      });
      queued++;
    }

    return res.status(202).json({ queued, providers });
  } catch (error) {
    return next(error);
  }
});

// GET /v1/wearables/connections
wearablesRouter.get("/connections", async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const connections = await prisma.wearableConnection.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    const health = await wearableSdk.getConnectionHealthAll(userId);

    return res.status(200).json({ connections, health });
  } catch (error) {
    return next(error);
  }
});

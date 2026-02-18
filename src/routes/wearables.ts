import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { JOBS, getBoss } from "../jobs/queue.js";
import { parseProvider } from "../lib/provider.js";

const backfillBodySchema = z.object({
  daysBack: z.number().int().min(1).max(365).default(60),
});

const syncBodySchema = z
  .object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .default({});

export const wearablesRouter = Router();

wearablesRouter.post("/:provider/backfill", async (req, res, next) => {
  try {
    const provider = parseProvider(req.params.provider);
    const userId = req.user?.id;

    if (!provider) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedBody = backfillBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: "Invalid body", details: parsedBody.error.flatten() });
    }

    const boss = await getBoss();
    const jobId = await boss.send(JOBS.BACKFILL, {
      userId,
      provider,
      daysBack: parsedBody.data.daysBack,
    });

    return res.status(202).json({
      message: "Backfill queued",
      provider,
      daysBack: parsedBody.data.daysBack,
      jobId,
    });
  } catch (error) {
    return next(error);
  }
});

wearablesRouter.post("/:provider/sync", async (req, res, next) => {
  try {
    const provider = parseProvider(req.params.provider);
    const userId = req.user?.id;

    if (!provider) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsedBody = syncBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ error: "Invalid body", details: parsedBody.error.flatten() });
    }

    const boss = await getBoss();
    const jobId = await boss.send(JOBS.SYNC, {
      userId,
      provider,
      startDate: parsedBody.data.startDate,
      endDate: parsedBody.data.endDate,
    });

    return res.status(202).json({
      message: "Sync queued",
      provider,
      startDate: parsedBody.data.startDate,
      endDate: parsedBody.data.endDate,
      jobId,
    });
  } catch (error) {
    return next(error);
  }
});

wearablesRouter.get("/connections", async (req, res, next) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const connections = await prisma.wearableConnection.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    const health = await wearableSdk.getConnectionHealthAll(userId);

    return res.status(200).json({
      connections,
      health,
    });
  } catch (error) {
    return next(error);
  }
});

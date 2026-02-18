import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/passport.js";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { JOBS, getBoss } from "../jobs/queue.js";
import { parseProvider } from "../lib/provider.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const oauthRouter = Router();

oauthRouter.get("/:provider/connect", requireAuth, async (req, res, next) => {
  try {
    const provider = parseProvider(req.params.provider);
    const userId = req.user?.id;

    if (!provider) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = wearableSdk.getAuthUrl(provider, userId);
    return res.redirect(url);
  } catch (error) {
    return next(error);
  }
});

oauthRouter.get("/:provider/callback", async (req, res, next) => {
  try {
    const provider = parseProvider(req.params.provider);

    if (!provider) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    const parsedQuery = callbackQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      return res.status(400).json({
        error: "Invalid callback parameters",
        details: parsedQuery.error.flatten(),
      });
    }

    const result = await wearableSdk.handleCallback(
      provider,
      parsedQuery.data.code,
      parsedQuery.data.state,
    );

    await prisma.wearableConnection.upsert({
      where: {
        userId_provider: {
          userId: result.userId,
          provider,
        },
      },
      create: {
        userId: result.userId,
        provider,
        providerUserId: result.providerUserId,
        status: "active",
      },
      update: {
        providerUserId: result.providerUserId,
        status: "active",
        connectedAt: new Date(),
      },
    });

    const boss = await getBoss();
    await boss.send(JOBS.BACKFILL, {
      userId: result.userId,
      provider,
      daysBack: 60,
    });

    return res.status(200).json({
      message: `Connected to ${provider}`,
      provider,
      userId: result.userId,
      providerUserId: result.providerUserId,
      initialBackfillQueued: true,
    });
  } catch (error) {
    return next(error);
  }
});

oauthRouter.post("/:provider/disconnect", requireAuth, async (req, res, next) => {
  try {
    const provider = parseProvider(req.params.provider);
    const userId = req.user?.id;

    if (!provider) {
      return res.status(400).json({ error: "Unsupported provider" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await prisma.wearableToken.delete({
      where: {
        userId_provider: {
          userId,
          provider,
        },
      },
    }).catch(() => undefined);

    await prisma.wearableConnection.updateMany({
      where: { userId, provider },
      data: {
        status: "disconnected",
      },
    });

    return res.status(200).json({
      message: `Disconnected ${provider}`,
    });
  } catch (error) {
    return next(error);
  }
});

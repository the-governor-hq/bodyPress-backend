import { Router } from "express";
import { z } from "zod";
import passport from "passport";
import jwt from "jsonwebtoken";
const { verify: jwtVerify } = jwt;
import { requireAuth } from "../auth/passport.js";
import { prisma } from "../db/prisma.js";
import { wearableSdk } from "../integrations/wearable-sdk.js";
import { JOBS, getBoss } from "../jobs/queue.js";
import { parseProvider } from "../lib/provider.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const oauthRouter = Router();

/**
 * Allow the frontend to pass the JWT as `?auth_token=...` for browser redirects
 * (standard Authorization header doesn't survive full-page redirects).
 */
function requireAuthOrToken(req: any, res: any, next: any) {
  const queryToken = req.query?.auth_token as string | undefined;
  if (queryToken) {
    try {
      const secret = env.JWT_PUBLIC_KEY ?? env.JWT_SECRET ?? "";
      const algorithms: any[] = env.JWT_PUBLIC_KEY ? ["RS256"] : ["HS256"];
      const payload = jwtVerify(queryToken, secret, { algorithms }) as any;
      req.user = { id: payload.sub, email: payload.email ?? null };
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid auth_token" });
    }
  }
  return requireAuth(req, res, next);
}

oauthRouter.get("/:provider/connect", requireAuthOrToken, async (req, res, next) => {
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

    let result;
    try {
      result = await wearableSdk.handleCallback(
        provider,
        parsedQuery.data.code,
        parsedQuery.data.state,
      );
    } catch (error) {
      // Handle OAuth-specific errors with user-friendly redirects
      const redirectUrl = new URL("/onboarding", env.FRONTEND_URL);
      redirectUrl.searchParams.set("error", "connection_failed");
      redirectUrl.searchParams.set("provider", provider);
      
      // Log the actual error for debugging
      logger.error({ error, provider }, `OAuth callback failed for ${provider}`);
      
      return res.redirect(redirectUrl.toString());
    }

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

    // Redirect to frontend onboarding success or dashboard
    const redirectUrl = new URL("/onboarding", env.FRONTEND_URL);
    redirectUrl.searchParams.set("connected", provider);
    return res.redirect(redirectUrl.toString());
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

import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { validationErrorHandler } from "@the-governor-hq/constitution-core";
import { initializeAuth, requireAuth } from "./auth/passport.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { apiLimiter } from "./lib/rate-limit.js";
import { briefingsRouter } from "./routes/briefings.js";
import { oauthRouter } from "./routes/oauth.js";
import { wearablesRouter } from "./routes/wearables.js";
import { dataRouter } from "./routes/data.js";
import { subscribersRouter } from "./routes/subscribers.js";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";
import { webhooksRouter } from "./routes/webhooks.js";

export function createApp() {
  const app = express();

  // ── Observability ──────────────────────────────────────────────────────────
  app.use(pinoHttp({ logger }));

  // ── Security ───────────────────────────────────────────────────────────────
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN, credentials: true }));

  // ── Global rate limit ──────────────────────────────────────────────────────
  app.use(apiLimiter);

  // ── Webhooks: raw body capture BEFORE express.json() ──────────────────────
  app.use("/webhooks", webhooksRouter);

  // ── Body parsing ───────────────────────────────────────────────────────────
  app.use(express.json({ limit: "1mb" }));
  app.use(initializeAuth());

  // ── Health ─────────────────────────────────────────────────────────────────
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, version: process.env.npm_package_version ?? "dev" });
  });

  // ── Public routes ──────────────────────────────────────────────────────────
  app.use("/v1/auth", authRouter);
  app.use("/v1/subscribers", subscribersRouter);
  app.use("/oauth", oauthRouter);              // OAuth redirects — public by design

  // ── Authenticated routes ───────────────────────────────────────────────────
  app.use("/v1/profile", requireAuth, profileRouter);
  app.use("/v1/wearables", requireAuth, wearablesRouter);
  app.use("/v1/wearables", requireAuth, dataRouter);
  app.use("/v1/briefings", requireAuth, briefingsRouter);

  // ── Error handling ─────────────────────────────────────────────────────────
  app.use(validationErrorHandler);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ error }, "Unhandled API error");
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}


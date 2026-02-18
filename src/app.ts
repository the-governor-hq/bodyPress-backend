import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { validationErrorHandler } from "@the-governor-hq/constitution-core";
import { initializeAuth, requireAuth } from "./auth/passport.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { briefingsRouter } from "./routes/briefings.js";
import { oauthRouter } from "./routes/oauth.js";
import { wearablesRouter } from "./routes/wearables.js";

export function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      logger,
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN }));
  app.use(express.json({ limit: "1mb" }));
  app.use(initializeAuth());

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/oauth", oauthRouter);
  app.use("/wearables", requireAuth, wearablesRouter);
  app.use("/briefings", requireAuth, briefingsRouter);

  app.use(validationErrorHandler);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ error }, "Unhandled API error");
    res.status(500).json({
      error: "Internal server error",
    });
  });

  return app;
}

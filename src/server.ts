import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { getBoss, stopBoss } from "./jobs/queue.js";
import { logger } from "./lib/logger.js";

const app = createApp();

async function bootstrap() {
  await prisma.$connect();
  await getBoss();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "BodyPress backend listening");
  });

  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down API server");
    server.close(async () => {
      await stopBoss();
      await prisma.$disconnect();
      process.exit(0);
    });
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch(async (error) => {
  logger.error({ error }, "Failed to start API server");
  await stopBoss();
  await prisma.$disconnect();
  process.exit(1);
});

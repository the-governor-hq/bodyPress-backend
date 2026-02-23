/**
 * @deprecated This standalone worker is no longer needed.
 * Job workers now run in the main server process (server.ts).
 * You can safely delete this file or keep it for legacy deployments.
 */

import { prisma } from "./db/prisma.js";
import { getBoss, stopBoss } from "./jobs/queue.js";
import { registerWearableJobs } from "./jobs/wearable-jobs.js";
import { logger } from "./lib/logger.js";

async function bootstrap() {
  logger.warn("⚠️  Standalone worker.ts is deprecated. Jobs now run in server.ts");
  await prisma.$connect();
  const boss = await getBoss();
  await registerWearableJobs(boss);

  logger.info("Wearable worker started");

  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutting down worker");
    await stopBoss();
    await prisma.$disconnect();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch(async (error) => {
  logger.error({ error }, "Failed to start worker");
  await stopBoss();
  await prisma.$disconnect();
  process.exit(1);
});

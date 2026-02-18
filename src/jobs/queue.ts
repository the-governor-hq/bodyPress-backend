import PgBoss from "pg-boss";
import { env } from "../config/env.js";

let boss: PgBoss | null = null;
let started = false;

export const JOBS = {
  BACKFILL: "wearables.backfill",
  SYNC: "wearables.sync",
  DAILY_FANOUT: "wearables.daily-fanout",
} as const;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss({
      connectionString: env.DATABASE_URL,
    });
  }

  if (!started) {
    await boss.start();
    started = true;
  }

  return boss;
}

export async function stopBoss() {
  if (boss && started) {
    await boss.stop();
    started = false;
  }
}

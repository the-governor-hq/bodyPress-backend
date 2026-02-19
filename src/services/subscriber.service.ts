// ---------------------------------------------------------------------------
// Subscriber service — newsletter sign-up + upsert user
// ---------------------------------------------------------------------------
import { prisma } from "../db/prisma.js";
import {
  sendEmail,
  buildWelcomeEmail,
} from "./email.service.js";
import { logger } from "../lib/logger.js";

export interface SubscribeInput {
  email: string;
  name?: string | null;
  timezone?: string | null;
  goals?: string[];
}

export interface SubscribeResult {
  userId: string;
  email: string;
  isNew: boolean;
}

export async function subscribe(input: SubscribeInput): Promise<SubscribeResult> {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });

  let userId: string;
  let isNew: boolean;

  if (existing) {
    userId = existing.id;
    isNew = false;

    // Update prefs if they changed
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: input.name ?? existing.name,
        timezone: input.timezone ?? existing.timezone,
        goals: input.goals ?? existing.goals,
        newsletterOptIn: true,
        subscribedAt: existing.subscribedAt ?? new Date(),
      },
    });
  } else {
    const created = await prisma.user.create({
      data: {
        email,
        name: input.name ?? null,
        timezone: input.timezone ?? "UTC",
        goals: input.goals ?? [],
        newsletterOptIn: true,
        subscribedAt: new Date(),
      },
    });
    userId = created.id;
    isNew = true;

    // Send welcome email (fire-and-forget — don't block subscription response)
    sendEmail({
      to: email,
      subject: "Welcome to BodyPress 🎉",
      html: buildWelcomeEmail(input.name ?? null),
    }).catch((err) => {
      logger.error({ err, email }, "Failed to send welcome email");
    });
  }

  logger.info({ userId, email, isNew }, "Subscriber upserted");
  return { userId, email, isNew };
}

export async function unsubscribe(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { newsletterOptIn: false },
  });

  logger.info({ userId: user.id, email }, "User unsubscribed");
}

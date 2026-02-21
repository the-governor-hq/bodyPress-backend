// ---------------------------------------------------------------------------
// Subscriber service — newsletter sign-up + upsert user
// ---------------------------------------------------------------------------
import { prisma } from "../db/prisma.js";
import {
  sendEmail,
  buildSubscribeVerifyEmail,
} from "./email.service.js";
import { logger } from "../lib/logger.js";

export interface SubscribeInput {
  email: string;
  name?: string | null;
  timezone?: string | null;
  goals?: string[];
}

export async function subscribe(input: SubscribeInput): Promise<void> {
  const email = input.email.toLowerCase().trim();

  // Create or update user (but don't subscribe yet — that happens on magic link verify)
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: input.name ?? null,
        timezone: input.timezone ?? "UTC",
        goals: input.goals ?? [],
        newsletterOptIn: false, // Will be set to true when they verify
      },
    });
    logger.info({ userId: user.id, email }, "User created via subscribe request");
  } else {
    // Update their preferences (but don't auto-subscribe — they need to verify)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: input.name ?? user.name,
        timezone: input.timezone ?? user.timezone,
        goals: input.goals ?? user.goals,
      },
    });
  }

  // Expire any existing active links
  await prisma.magicLink.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  // Generate magic link token
  const crypto = await import("node:crypto");
  const token = crypto.randomBytes(32).toString("hex");
  const { env } = await import("../config/env.js");
  const expiresAt = new Date(Date.now() + env.MAGIC_LINK_TTL_SECONDS * 1000);

  await prisma.magicLink.create({
    data: { userId: user.id, token, expiresAt },
  });

  const verifyUrl = `${env.FRONTEND_URL}/auth/verify?token=${token}`;

  // Send verification email with clear CTA button
  await sendEmail({
    to: email,
    subject: "Confirm your BodyPress subscription",
    html: buildSubscribeVerifyEmail(input.name ?? null, verifyUrl),
  });

  logger.info({ userId: user.id, email }, "Subscription verification link sent");
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

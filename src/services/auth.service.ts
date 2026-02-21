// ---------------------------------------------------------------------------
// Magic-link auth service — passwordless email sign-in
// ---------------------------------------------------------------------------
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { sendEmail, buildMagicLinkEmail } from "./email.service.js";
import { logger } from "../lib/logger.js";

function signJwt(userId: string, email: string | null): string {
  const secret = env.JWT_SECRET ?? env.JWT_PUBLIC_KEY ?? "";
  return jwt.sign(
    { sub: userId, email },
    secret,
    { expiresIn: env.JWT_EXPIRES_IN ?? "7d" } as jwt.SignOptions,
  );
}

function makeToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Request a magic link — creates/upserts user, stores token, sends email
// ---------------------------------------------------------------------------
export async function requestMagicLink(email: string, name?: string | null): Promise<void> {
  const normalEmail = email.toLowerCase().trim();

  let user = await prisma.user.findUnique({ where: { email: normalEmail } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalEmail,
        name: name ?? null,
        newsletterOptIn: false,
      },
    });
    logger.info({ userId: user.id, email: normalEmail }, "User created via magic link request");
  }

  // Expire any existing active links (clean-up)
  await prisma.magicLink.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() }, // expire immediately
  });

  const token = makeToken();
  const expiresAt = new Date(Date.now() + env.MAGIC_LINK_TTL_SECONDS * 1000);

  await prisma.magicLink.create({
    data: { userId: user.id, token, expiresAt },
  });

  const magicUrl = `${env.FRONTEND_URL}/auth/verify?token=${token}`;

  await sendEmail({
    to: normalEmail,
    subject: "Sign in to BodyPress",
    html: buildMagicLinkEmail(user.name, magicUrl),
  });

  logger.info({ userId: user.id, email: normalEmail }, "Magic link sent");
}

// ---------------------------------------------------------------------------
// Verify token — marks as used, returns signed JWT
// ---------------------------------------------------------------------------
export interface VerifyResult {
  token: string;
  userId: string;
  email: string | null;
}

export async function verifyMagicLink(token: string): Promise<VerifyResult> {
  const link = await prisma.magicLink.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!link) {
    throw Object.assign(new Error("Magic link not found"), { code: "NOT_FOUND" });
  }

  if (link.usedAt) {
    throw Object.assign(new Error("Magic link already used"), { code: "ALREADY_USED" });
  }

  if (link.expiresAt < new Date()) {
    throw Object.assign(new Error("Magic link expired"), { code: "EXPIRED" });
  }

  // Mark link as used
  await prisma.magicLink.update({
    where: { id: link.id },
    data: { usedAt: new Date() },
  });

  // Complete subscription if not already opted in
  if (!link.user.newsletterOptIn) {
    await prisma.user.update({
      where: { id: link.user.id },
      data: {
        newsletterOptIn: true,
        subscribedAt: new Date(),
      },
    });
    logger.info({ userId: link.user.id }, "Subscription confirmed via magic link");
  }

  const jwt = signJwt(link.user.id, link.user.email);
  logger.info({ userId: link.user.id }, "Magic link verified — JWT issued");

  return {
    token: jwt,
    userId: link.user.id,
    email: link.user.email,
  };
}

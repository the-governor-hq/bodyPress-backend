// ---------------------------------------------------------------------------
// Email service — supports SMTP (Ethereal.email for dev) & Resend
// Falls back to console.log when no provider is configured (dev mode).
// ---------------------------------------------------------------------------
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

// ---------------------------------------------------------------------------
// SMTP Transporter (lazy singleton)
// ---------------------------------------------------------------------------
let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
      throw new Error("SMTP configuration incomplete");
    }

    smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });

    logger.info(
      { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
      "[email] SMTP transporter initialized",
    );
  }

  return smtpTransporter;
}

// ---------------------------------------------------------------------------
// Send via SMTP
// ---------------------------------------------------------------------------
async function sendViaSMTP(opts: SendEmailOptions): Promise<{ messageId: string }> {
  const transporter = getSmtpTransporter();
  const info = await transporter.sendMail({
    from: opts.from ?? env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });

  // For Ethereal.email, log preview URL
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) {
    logger.info({ previewUrl }, "[email] Ethereal preview available");
  }

  return { messageId: info.messageId };
}

// ---------------------------------------------------------------------------
// Send via Resend
// ---------------------------------------------------------------------------
async function sendViaResend(opts: SendEmailOptions): Promise<{ id: string }> {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY not set");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from ?? env.EMAIL_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  return response.json() as Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Main send function — dispatches to provider
// ---------------------------------------------------------------------------
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  try {
    if (env.EMAIL_PROVIDER === "smtp") {
      // Check if SMTP is configured
      if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASS) {
        logger.warn(
          { to: opts.to, subject: opts.subject },
          "[email] SMTP not configured — logging email instead",
        );
        logger.debug({ email: opts }, "[email] dev preview");
        return;
      }

      const result = await sendViaSMTP(opts);
      logger.info(
        { to: opts.to, subject: opts.subject, messageId: result.messageId },
        "[email] sent via SMTP",
      );
    } else if (env.EMAIL_PROVIDER === "resend") {
      if (!env.RESEND_API_KEY) {
        logger.warn(
          { to: opts.to, subject: opts.subject },
          "[email] RESEND_API_KEY not set — logging email instead",
        );
        logger.debug({ email: opts }, "[email] dev preview");
        return;
      }

      const result = await sendViaResend(opts);
      logger.info(
        { to: opts.to, subject: opts.subject, id: result.id },
        "[email] sent via Resend",
      );
    }
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, "[email] failed to send");
    throw err;
  }
}

// ── Template helpers ──────────────────────────────────────────────────────────

export function buildMagicLinkEmail(name: string | null, magicUrl: string): SendEmailOptions["html"] {
  const displayName = name ?? "there";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width"/></head>
<body style="font-family:system-ui,sans-serif;background:#0d0f1a;color:#f0f0f0;padding:32px;max-width:520px;margin:0 auto;">
  <h1 style="color:#5ecfb2;font-size:24px;margin-bottom:8px;">BodyPress</h1>
  <p style="margin-top:0;color:#a0a0b0;font-size:14px;">Your Body, Briefed Daily</p>
  <hr style="border:none;border-top:1px solid #2a2d3a;margin:24px 0;" />
  <p>Hey ${displayName} 👋</p>
  <p>Click the button below to sign in. This link expires in <strong>15 minutes</strong> and can only be used once.</p>
  <div style="margin:32px 0;text-align:center;">
    <a href="${magicUrl}"
       style="background:#5ecfb2;color:#0d0f1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
      Sign in to BodyPress
    </a>
  </div>
  <p style="font-size:12px;color:#666;margin-top:32px;">
    If you didn't request this email, you can safely ignore it.<br />
    <a href="${magicUrl}" style="color:#5ecfb2;">${magicUrl}</a>
  </p>
</body>
</html>
  `.trim();
}

export function buildSubscribeVerifyEmail(name: string | null, verifyUrl: string): SendEmailOptions["html"] {
  const displayName = name ?? "there";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width"/></head>
<body style="font-family:system-ui,sans-serif;background:#0d0f1a;color:#f0f0f0;padding:32px;max-width:520px;margin:0 auto;">
  <h1 style="color:#5ecfb2;font-size:24px;margin-bottom:8px;">BodyPress</h1>
  <p style="margin-top:0;color:#a0a0b0;font-size:14px;">Your Body, Briefed Daily</p>
  <hr style="border:none;border-top:1px solid #2a2d3a;margin:24px 0;" />
  <p>Hey ${displayName} 👋</p>
  <p>Thanks for subscribing! Click the button below to <strong>confirm your subscription</strong> and sign in to your account.</p>
  <p>This link expires in <strong>15 minutes</strong> and can only be used once.</p>
  <div style="margin:32px 0;text-align:center;">
    <a href="${verifyUrl}"
       style="background:#5ecfb2;color:#0d0f1a;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">
      Confirm Subscription
    </a>
  </div>
  <p style="font-size:12px;color:#666;margin-top:32px;">
    If you didn't request this, you can safely ignore this email.<br />
    <a href="${verifyUrl}" style="color:#5ecfb2;word-break:break-all;">${verifyUrl}</a>
  </p>
</body>
</html>
  `.trim();
}

export function buildWelcomeEmail(name: string | null): SendEmailOptions["html"] {
  const displayName = name ?? "there";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family:system-ui,sans-serif;background:#0d0f1a;color:#f0f0f0;padding:32px;max-width:520px;margin:0 auto;">
  <h1 style="color:#5ecfb2;">Welcome to BodyPress 🎉</h1>
  <p>Hey ${displayName},</p>
  <p>You're now subscribed to your daily health briefing. We'll pull your wearable data, layer in environmental context (weather, air quality, UV), and deliver a sharp summary every morning.</p>
  <h3 style="color:#5ecfb2;">Next step</h3>
  <p>Connect your Garmin or Fitbit device to start syncing your health data.</p>
  <p style="margin-top:32px;font-size:12px;color:#666;">
    You're receiving this because you signed up at bodypress.app.<br />
    <a href="{{unsubscribeUrl}}" style="color:#5ecfb2;">Unsubscribe</a>
  </p>
</body>
</html>
  `.trim();
}

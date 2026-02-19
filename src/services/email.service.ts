// ---------------------------------------------------------------------------
// Email service — thin Resend wrapper (https://resend.com)
// Falls back to console.log when RESEND_API_KEY is not set (dev mode).
// ---------------------------------------------------------------------------
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

async function sendViaResend(opts: SendEmailOptions): Promise<{ id: string }> {
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

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!env.RESEND_API_KEY) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "[email] RESEND_API_KEY not set — logging email instead of sending",
    );
    logger.debug({ email: opts }, "[email] dev preview");
    return;
  }

  try {
    const result = await sendViaResend(opts);
    logger.info({ to: opts.to, subject: opts.subject, id: result.id }, "[email] sent");
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

import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().optional(),
    JWT_PUBLIC_KEY: z.string().optional(),
    JWT_EXPIRES_IN: z.string().default("7d"),
    CORS_ORIGIN: z.string().default("*"),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),

    // Wearable providers
    GARMIN_CLIENT_ID: z.string().optional(),
    GARMIN_CLIENT_SECRET: z.string().optional(),
    GARMIN_REDIRECT_URI: z.string().url().optional(),
    GARMIN_WEBHOOK_SECRET: z.string().optional(),
    FITBIT_CLIENT_ID: z.string().optional(),
    FITBIT_CLIENT_SECRET: z.string().optional(),
    FITBIT_REDIRECT_URI: z.string().url().optional(),
    FITBIT_WEBHOOK_SUBSCRIBER_CODE: z.string().optional(),

    // Background jobs
    SYNC_CRON: z.string().default("0 2 * * *"),

    // Email (SMTP or Resend)
    EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: z.coerce.boolean().default(false),
    EMAIL_FROM: z.string().default("BodyPress <hello@bodypress.app>"),

    // Magic link TTL (seconds)
    MAGIC_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
  })
  .superRefine((value, ctx) => {
    if (!value.JWT_SECRET && !value.JWT_PUBLIC_KEY) {
      ctx.addIssue({
        path: ["JWT_SECRET"],
        code: z.ZodIssueCode.custom,
        message: "JWT_SECRET or JWT_PUBLIC_KEY must be configured",
      });
    }

    const hasGarmin =
      value.GARMIN_CLIENT_ID && value.GARMIN_CLIENT_SECRET && value.GARMIN_REDIRECT_URI;
    const hasFitbit =
      value.FITBIT_CLIENT_ID && value.FITBIT_CLIENT_SECRET && value.FITBIT_REDIRECT_URI;

    if (!hasGarmin && !hasFitbit) {
      ctx.addIssue({
        path: ["GARMIN_CLIENT_ID"],
        code: z.ZodIssueCode.custom,
        message: "At least one provider must be configured (Garmin or Fitbit)",
      });
    }
  });

export const env = envSchema.parse(process.env);

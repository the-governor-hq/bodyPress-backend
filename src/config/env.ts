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
    CORS_ORIGIN: z.string().default("*"),
    GARMIN_CLIENT_ID: z.string().optional(),
    GARMIN_CLIENT_SECRET: z.string().optional(),
    GARMIN_REDIRECT_URI: z.string().url().optional(),
    FITBIT_CLIENT_ID: z.string().optional(),
    FITBIT_CLIENT_SECRET: z.string().optional(),
    FITBIT_REDIRECT_URI: z.string().url().optional(),
    SYNC_CRON: z.string().default("0 2 * * *"),
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

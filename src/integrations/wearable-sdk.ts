import { WearableSDK } from "@the-governor-hq/wearable-sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

const providers: Record<string, { clientId: string; clientSecret: string; redirectUri: string }> =
  {};

if (env.GARMIN_CLIENT_ID && env.GARMIN_CLIENT_SECRET && env.GARMIN_REDIRECT_URI) {
  providers.garmin = {
    clientId: env.GARMIN_CLIENT_ID,
    clientSecret: env.GARMIN_CLIENT_SECRET,
    redirectUri: env.GARMIN_REDIRECT_URI,
  };
}

if (env.FITBIT_CLIENT_ID && env.FITBIT_CLIENT_SECRET && env.FITBIT_REDIRECT_URI) {
  providers.fitbit = {
    clientId: env.FITBIT_CLIENT_ID,
    clientSecret: env.FITBIT_CLIENT_SECRET,
    redirectUri: env.FITBIT_REDIRECT_URI,
  };
}

export const wearableSdk = new WearableSDK({
  prisma,
  providers,
  debug: env.NODE_ENV !== "production",
});

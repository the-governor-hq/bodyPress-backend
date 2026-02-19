import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // process.env used directly (not env() helper) so that `prisma generate`
    // in the Docker build stage does not throw when DATABASE_URL is absent.
    url: process.env.DATABASE_URL ?? "",
  },
});

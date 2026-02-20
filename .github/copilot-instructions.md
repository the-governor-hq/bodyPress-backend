# Copilot Instructions — bodypress-backend

## Stack
Node 22, TypeScript (ESM, NodeNext), Express 5, Prisma 7, neon pg, Fly.io.

---

## Prisma 7 — Non-negotiable rules

### 1. Generated client is committed to git
`src/generated/prisma/` is **committed**. Never add it to `.gitignore`.
After any schema change, run locally:
```
npx prisma generate
git add src/generated/
```
**Do NOT run `prisma generate` inside the Dockerfile.** The committed files are
what gets compiled and deployed — no regeneration in CI/Docker.

### 2. schema.prisma has NO `url` in the datasource block
```prisma
# ✅ correct
datasource db {
  provider = "postgresql"
}

# ❌ WRONG — removed in Prisma 7
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 3. prisma.config.ts lives at the project root (next to package.json)
```ts
// prisma.config.ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Use process.env directly, NOT the env() helper.
    // env() throws if DATABASE_URL is absent (e.g. during tsc in Docker).
    url: process.env.DATABASE_URL ?? "",
  },
});
```
Import is `from "prisma/config"` — NOT `from "@prisma/client"`.

### 4. PrismaClient requires a driver adapter
```ts
// src/db/prisma.ts
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
export const prisma = new PrismaClient({ adapter, log: ["warn", "error"] });
```
**Never** `new PrismaClient()` without an adapter in Prisma 7.

### 5. All imports come from the generated path
```ts
// ✅
import { PrismaClient } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";

// ❌ — @prisma/client no longer exports models/types directly
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
```

### 6. generator block in schema.prisma
```prisma
generator client {
  provider = "prisma-client"          // NOT "prisma-client-js"
  output   = "../src/generated/prisma"
}
```

### 7. Migrations
- Local dev: `npx prisma migrate dev --name <description>`
- Production (Fly release command): `npx prisma migrate deploy`
- `migrate deploy` reads the database URL from `prisma.config.ts`

---

## Fly.io deployment

- `fly.toml` is minimal — no multi-process groups unless explicitly needed.
- Secrets set via `fly secrets set KEY=value`.
- Release command (`npx prisma migrate deploy`) runs before new machines start.
- App listens on `0.0.0.0` (Express default) — no extra config needed.

## DO NOT
- Downgrade Prisma.
- Add `url` back to `schema.prisma` datasource.
- Run `prisma generate` in Docker.
- Import from `@prisma/client` directly (use the generated path).
- Use `prisma/config`'s `env()` helper where `DATABASE_URL` may be absent.

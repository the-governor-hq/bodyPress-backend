# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma/ ./prisma/

# Install all deps (dev deps required for tsc)
RUN npm ci

# Copy source and compile (generated client is committed and included in src/)
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma/ ./prisma/

# Production dependencies only
RUN npm ci --omit=dev

# Copy Prisma CLI from builder so `prisma migrate deploy` works in release command
COPY --from=builder /app/node_modules/prisma        ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma   ./node_modules/.bin/prisma

# Prisma 7 uses pure JS driver adapters — no .prisma native engine to copy

# Copy prisma.config.ts so the CLI can find datasource config in release command
COPY prisma.config.ts ./

# Copy compiled output (includes dist/generated/prisma from tsc)
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/server.js"]

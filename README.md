# bodypress-backend

Node.js + Express backend for BodyPress with Neon Postgres (Prisma), Garmin/Fitbit OAuth via `@the-governor-hq/wearable-sdk`, and background sync jobs via `pg-boss`.

## Features

- OAuth connect/callback/disconnect endpoints for Garmin and Fitbit
- Prisma models for wearable tokens, raw payload ingest, and normalized summaries
- Automatic initial backfill queueing (`60` days by default)
- Daily sync fanout schedule with provider sync jobs
- JWT passwordless API auth using Passport JWT
- Constitution middleware integrated for briefing safety validation

## Quick start

1. Create `.env` from `.env.example`.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate Prisma client and migrate database:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate -- --name init
   ```

4. Run API and worker in separate terminals:

   ```bash
   npm run dev
   npm run dev:worker
   ```

## API endpoints

- `GET /healthz`
- `GET /oauth/:provider/connect` (auth required)
- `GET /oauth/:provider/callback` (provider redirect)
- `POST /oauth/:provider/disconnect` (auth required)
- `POST /wearables/:provider/backfill` (auth required)
- `POST /wearables/:provider/sync` (auth required)
- `GET /wearables/connections` (auth required)
- `POST /briefings/preview` (auth required)

## Historical + daily sync strategy

- On OAuth callback, enqueue one `wearables.backfill` job with `daysBack=60`.
- Worker executes backfill, fetches activities/sleep/dailies, and stores:
  - raw provider payloads in `wearable_raw_ingests`
  - normalized records in `wearable_activities`, `wearable_sleep`, `wearable_dailies`
- Worker schedules `wearables.daily-fanout` via `SYNC_CRON` (default `0 2 * * *`).
- Daily fanout enqueues `wearables.sync` for each active connection.
- Sync jobs query from `(lastSyncedAt - 2 days)` to today for late-arriving records and idempotent upserts.

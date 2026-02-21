# bodypress-backend

Node.js + Express 5 backend for BodyPress — Neon Postgres (Prisma 7), Garmin/Fitbit OAuth via `@the-governor-hq/wearable-sdk`, background sync jobs via `pg-boss`, passwordless magic-link auth, and newsletter subscription management.

## Features

- **Subscriber flow** — `POST /v1/subscribers` sends verification email with magic link to confirm subscription
- **Magic-link auth** — passwordless email login + subscription verification; 15-min expiring tokens stored in DB
- **JWT sessions** — HS256 (dev) / RS256 (prod) tokens via Passport JWT
- **OAuth wearable connect** — Garmin + Fitbit PKCE/OAuth2, token refresh, historical 60-day backfill on first connect
- **Webhook ingestion** — HMAC-verified push endpoints for Garmin and Fitbit activity/sleep updates
- **Profile management** — name, timezone, goals, notify time, onboarding completion flag
- **Wearable data API** — paginated activities, sleep, dailies, and aggregated summary
- **Background jobs** — pg-boss queue: backfill (initial), sync (per-user), daily-fanout (cron)
- **Rate limiting** — in-memory sliding window: 100 req/min global, 10/15min auth, 5/10min subscribe
- **Constitution middleware** — briefing safety validation

## Quick start

1. Copy env file and fill in secrets:

   ```bash
   cp .env.example .env
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Migrate database:

   ```bash
   npx prisma migrate dev --name init
   ```

4. Run API and worker in separate terminals:

   ```bash
   npm run dev          # Express API on :4000
   npm run dev:worker   # pg-boss background worker
   ```

## Email configuration

The service supports two email providers: **SMTP** (Ethereal.email for dev/testing) and **Resend** (for production).

### Development: Ethereal.email (SMTP)

For local development, use Ethereal.email — a fake SMTP service that captures emails for preview:

1. Generate Ethereal credentials:

   ```bash
   npm run email:setup
   ```

   This will:
   - Create a temporary Ethereal.email test account
   - Append credentials to your `.env` file
   - Display the web interface URL

2. When emails are sent (e.g., magic links), check server logs for the preview URL:

   ```
   [email] Ethereal preview available: https://ethereal.email/message/...
   ```

3. Visit the URL to view the email without actual delivery.

**Note:** Ethereal accounts are temporary. Re-run the script if credentials expire.

### Production: Resend

For production, use Resend:

```bash
# .env
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=BodyPress <hello@bodypress.app>
```

## API reference

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check |
| `POST` | `/v1/subscribers` | Send subscription verification email with magic link |
| `DELETE` | `/v1/subscribers` | Unsubscribe |
| `POST` | `/v1/auth/request-link` | Send magic link to email |
| `GET` | `/v1/auth/verify?token=` | Exchange magic link → JWT + complete subscription |

### Auth required (`Authorization: Bearer <jwt>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/auth/me` | Current user + connections |
| `GET` | `/v1/profile` | Full profile |
| `PATCH` | `/v1/profile` | Update name / timezone / goals / notifyAt / onboardingDone |
| `GET` | `/oauth/:provider/connect` | Initiate Garmin or Fitbit OAuth (also accepts `?auth_token=`) |
| `GET` | `/oauth/:provider/callback` | OAuth callback — redirects to `FRONTEND_URL/onboarding?connected=<provider>` |
| `POST` | `/oauth/:provider/disconnect` | Revoke wearable connection |
| `GET` | `/v1/wearables/connections` | List connected wearables |
| `POST` | `/v1/wearables/:provider/backfill` | Queue manual backfill |
| `POST` | `/v1/wearables/:provider/sync` | Queue manual sync |
| `GET` | `/v1/data/activities` | Paginated activity records |
| `GET` | `/v1/data/sleep` | Paginated sleep records |
| `GET` | `/v1/data/dailies` | Paginated daily summaries |
| `GET` | `/v1/data/summary` | Aggregated stats (30-day window) |
| `POST` | `/v1/briefings/preview` | Generate a briefing preview |

### Webhooks (HMAC-verified, no JWT)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/garmin` | Garmin activity push |
| `GET` | `/webhooks/fitbit` | Fitbit subscriber verification |
| `POST` | `/webhooks/fitbit` | Fitbit activity push |

## User + subscription flow

```
1. User enters email → POST /v1/subscribers
   └─ creates/updates User (newsletterOptIn=false), generates MagicLink,
      sends verification email with "Confirm Subscription" button

2. User clicks email link → GET /v1/auth/verify?token=
   └─ validates token, sets newsletterOptIn=true + subscribedAt,
      marks link as used, returns signed JWT

3. PATCH /v1/profile (with JWT)
   └─ saves name, goals, timezone, onboardingDone=true

4. GET /oauth/:provider/connect?auth_token=<jwt>
   └─ redirects to provider OAuth consent page

5. Provider redirects to GET /oauth/:provider/callback
   └─ stores token, queues 60-day backfill, redirects to frontend

---

Alternative: Existing user login

1. POST /v1/auth/request-link (email)
   └─ creates MagicLink (15-min TTL), sends email with "Sign in" button

2. User clicks link → GET /v1/auth/verify?token=
   └─ validates DB token, marks used, returns signed JWT

3. Continue with profile/OAuth steps above
```

## Historical + daily sync strategy

- On OAuth callback, enqueue one `wearables.backfill` job (`daysBack=60`).
- `SYNC_CRON` (default `0 2 * * *`) triggers daily fanout — one sync job per active connection.
- Webhook pushes queue an immediate sync for the affected user.

## API collections

Import from `collections/` into Postman or Insomnia for a ready-to-use request suite.

- Worker executes backfill, fetches activities/sleep/dailies, and stores:
  - raw provider payloads in `wearable_raw_ingests`
  - normalized records in `wearable_activities`, `wearable_sleep`, `wearable_dailies`
- Worker schedules `wearables.daily-fanout` via `SYNC_CRON` (default `0 2 * * *`).
- Daily fanout enqueues `wearables.sync` for each active connection.
- Sync jobs query from `(lastSyncedAt - 2 days)` to today for late-arriving records and idempotent upserts.

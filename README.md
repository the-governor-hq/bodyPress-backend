# bodypress-backend

Node.js 22 + Express 5 backend for BodyPress — Neon Postgres (Prisma 7 with driver adapter), Garmin/Fitbit OAuth via `@the-governor-hq/wearable-sdk`, DB-based background sync jobs via `node-cron`, passwordless magic-link auth, and newsletter subscription management.

## Features

- **Subscriber flow** — `POST /v1/subscribers` sends verification email with magic link to confirm subscription
- **Magic-link auth** — passwordless email login + subscription verification; 15-min expiring tokens stored in DB
- **JWT sessions** — HS256 (dev) / RS256 (prod) tokens via Passport JWT
- **OAuth wearable connect** — Garmin + Fitbit PKCE/OAuth2, token refresh, historical 60-day backfill on first connect
- **Webhook ingestion** — HMAC-verified push endpoints; Garmin push data is normalized and stored directly (no pull API needed), with pull-based fallback sync
- **Profile management** — name, timezone, goals, notify time, onboarding completion flag
- **Wearable data API** — paginated activities, sleep, dailies, and aggregated summary
- **Background jobs** — DB-based `sync_jobs` queue polled by `node-cron`: backfill (initial), sync (per-user), daily-fanout
- **Rate limiting** — in-memory sliding window: 100 req/min global, 10/15min auth, 5/10min subscribe
- **Constitution middleware** — briefing safety validation
- **Fly.io ready** — Dockerfile, release command (`prisma migrate deploy`), no in-Docker codegen

## Quick start

```bash
# 1. Clone & install
npm install

# 2. Environment — copy and fill in secrets
cp .env.example .env
#    Required: DATABASE_URL, JWT_SECRET
#    Wearables: GARMIN_CLIENT_ID/SECRET/REDIRECT_URI (and/or FITBIT)

# 3. Generate Prisma client (committed to git, but needed after fresh clone)
npx prisma generate

# 4. Create / migrate database
npx prisma migrate dev

# 5. (Optional) Set up a dev email inbox
npm run email:setup        # creates Ethereal SMTP creds → appends to .env

# 6. Start dev server (auto-reloads, background jobs run in-process)
npm run dev                # Express API + sync scheduler on :4000
```

> **Note:** The dev server uses `tsx watch` — do **not** restart it manually after code changes.

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
SMTP_EMAIL_FROM=BodyPress <hello@governor-hq.com>
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
| `POST` | `/webhooks/garmin` | Garmin push — normalizes & stores data directly, enqueues pull fallback |
| `GET` | `/webhooks/fitbit` | Fitbit subscriber verification |
| `POST` | `/webhooks/fitbit` | Fitbit push — enqueues pull-based sync |

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

## How data sync works (for developers)

### Automatic (you don't call anything):

1. **First connect** → 60 days of history fetched automatically after OAuth callback (strategic backfill: 2-day high priority → 7-day medium → 7-day low)
2. **Garmin webhooks** → Push payloads contain **full summary data** — normalized & stored immediately, no pull API required. A fallback pull job is still enqueued for completeness.
3. **Fitbit webhooks** → Push notification triggers a pull-based sync job
4. **Scheduled fanout** → Cron (`SYNC_CRON`, default every minute in dev / `0 2 * * *` in prod) syncs stale connections (>30 min since last sync)

### Manual control (optional):

| Route | When to use |
|-------|-------------|
| `POST /v1/wearables/:provider/sync` | Force sync now for logged-in user |
| `POST /v1/wearables/:provider/backfill` | Re-fetch historical data (custom `daysBack`) |

### What gets stored:

- Raw provider JSON → `wearable_raw_ingests` (for debugging & reprocessing)
- Normalized data → `wearable_activities`, `wearable_sleep`, `wearable_dailies`

### Garmin portal setup (push endpoints):

In the [Garmin Connect Developer Program](https://developerportal.garmin.com/) → **Endpoint Configuration**, set your webhook URL and enable:

| Endpoint | URL |
|----------|-----|
| ACTIVITY - Activities | `https://<your-app>.fly.dev/webhooks/garmin` |
| HEALTH - Dailies | `https://<your-app>.fly.dev/webhooks/garmin` |
| HEALTH - Sleep | `https://<your-app>.fly.dev/webhooks/garmin` |

All three point to the same handler — it discriminates by payload key.

**TL;DR:** Just send users through OAuth (`GET /oauth/:provider/connect`). Everything else is automatic.

## API collections

Import from `collections/` into Postman or Insomnia for a ready-to-use request suite.

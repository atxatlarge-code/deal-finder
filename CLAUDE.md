# Deal Finder — CLAUDE.md

Project instructions and findings for Claude Code. These override all default behavior.

---

## Project Overview

**Deal Finder** — Seller-Intent Score Engine for Dallas real estate wholesalers.
Surfaces motivated sellers by aggregating public-record distress signals (code violations,
foreclosures, tax delinquency, divorce filings, bankruptcy) and scoring every parcel in Dallas County.

**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (Postgres + Auth),
Vitest, Playwright, Bun

**Repo:** `atxatlarge-code/deal-finder` (private)
**Deploy:** Vercel (auto-deploy on push to `master`)
**Branch convention:** `master` is the working branch; `main` is the Vercel production target

---

## Package Manager

Always use `bun`. Never use `npm`, `yarn`, or `pnpm`.

---

## Key Architectural Decisions

### Middleware
Standard `middleware.ts` (not `proxy.ts`) is required for Vercel deployment.
Next.js 16 locally warns about using `middleware` vs `proxy` naming — **ignore this warning**.
The file must export `async function middleware(request: NextRequest)`.

### Supabase Clients
- **Server pages / route handlers (auth-gated):** `createClient()` from `@/lib/supabase/server` — uses cookies, respects RLS
- **Cached data fetches inside `unstable_cache`:** `adminClient()` (service role key, no cookies) — `unstable_cache` cannot call `cookies()` internally; using the user client crashes at runtime
- **Scripts / cron jobs:** `bun:sql` direct Postgres via `DATABASE_URL` env var (much faster than Supabase REST for bulk operations)

### Caching
`unstable_cache` with 5-minute TTL (`revalidate: 300`) for the leads list and hot leads.
Cache is keyed per filter combination. Tags (`properties-list`) allow manual invalidation.
Delete `.next/cache` to bust stale cache during development.

### RLS
Row Level Security is enabled on all tables. The `adminClient()` (service role) bypasses RLS.
RLS policies grant SELECT to `authenticated` role on `properties`, `signals`, `lead_scores`.

---

## Database Schema

Tables: `properties`, `signals`, `lead_scores`, `lead_status`

### properties
```
id              uuid PK
parcel_id       text UNIQUE  -- DCAD account number
property_address text
mailing_address  text
owner_name       text
ownership_type   text        -- INDIVIDUAL | LLC | TRUST | ESTATE
assessed_value   numeric
equity           numeric
is_absentee      boolean     -- mailing ≠ property address
score            numeric     -- denormalized latest score (optional)
updated_at       timestamptz
```

### signals
```
id           uuid PK
property_id  uuid FK → properties.id
signal_type  text  -- FORECLOSURE | DIVORCE | TAX_DELINQUENCY | CODE_VIOLATION | VACANT | BANKRUPTCY
case_number  text UNIQUE
filed_at     timestamptz
description  text
source_url   text
```

### lead_scores
```
id           uuid PK
property_id  uuid FK → properties.id
score        int
signal_count int
score_version text  -- 'v1'
scored_at    timestamptz
expires_at   timestamptz  -- scored_at + 90 days
```

---

## Scoring Algorithm (`lib/scoring.ts`)

Score = `min(100, round((base + absentee_bonus) × ownership_multiplier))`

**Signal weights:**
- FORECLOSURE: 40 pts
- DIVORCE: 35 pts
- BANKRUPTCY: 35 pts
- TAX_DELINQUENCY: 30 pts
- CODE_VIOLATION: 20 pts
- VACANT: 15 pts

Repeated signals of same type: +5 pts each (max 3 extras)
Diversity bonus (2+ different types): +10 pts
Absentee bonus: +15 pts
Ownership multiplier: ESTATE 1.2 › TRUST 1.15 › LLC 1.1 › INDIVIDUAL 1.0

**Score bands:** ≥70 = high (black), ≥50 = med (gray), <50 = low (muted)

---

## Data Pipeline

### DCAD Property Import
- Source: `/Users/jaketrigg/Documents/Products/Deal Finder/dallas-re-pipeline/data/raw/dcad_account.CSV`
- Script: `bun scripts/import-dcad.ts --file [path]`
- Filters: `DIVISION_CD === 'RES'`, excludes `EXCLUDE_OWNER === 'Y'`
- Result: 678,528 properties imported in ~8 min via `sql.unsafe()` multi-row VALUES batches

### DCAD Values Import
- Source: `ACCOUNT_APPRL_YEAR.CSV` in DCAD2025_CURRENT download
- Script: `bun scripts/import-dcad-values.ts --file [path]`
- Updates `assessed_value` on existing properties
- Result: 680,334 rows updated

### Signals Import (Code Violations)
- Source: SQLite pipeline DB (`raw_violations` table)
- Script: `bun scripts/import-signals.ts --db [path]`
- Address matching: exact UPPER() match, then first-10-chars prefix fallback
- Result: 222 signals imported out of 391 violations

### Signals Refresh (Dallas 311 API)
- Script: `bun scripts/refresh-signals.ts`
- Fetches last 14 days from Socrata API dataset `gc4d-8a49`
- Requires `DALLAS_APP_TOKEN` env var

### Scoring Cron
- Route: `POST /api/cron/score`
- Auth: `Authorization: Bearer $CRON_SECRET` header
- Schedule: every Monday at 6am CT (Vercel cron: `"0 6 * * 1"`)
- Result: first run scored 222 properties

### Bankruptcy Signals (CourtListener/RECAP)
- Webhook: `POST /api/webhooks/courtlistener` — receives `search.alert.recap` events
  - Auth: `Authorization: Bearer $COURTLISTENER_WEBHOOK_SECRET`
  - Parses debtor address from `extra_info`, matches to Dallas property, upserts BANKRUPTCY signal
  - Re-scores matched properties immediately (no waiting for weekly cron)
- Backfill: `bun scripts/import-bankruptcy.ts [--days-back 90] [--dry-run] [--limit N]`
- CourtListener setup:
  1. Register at courtlistener.com → get API token
  2. Profile → Webhooks → Add webhook (URL: `https://<domain>/api/webhooks/courtlistener`, Event: Search Alert)
  3. Create saved RECAP search: `court:txnb type:r`
  4. Link saved search to the webhook

---

## Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=         # Service role key (server-only, bypasses RLS)
CRON_SECRET=                       # Shared secret for /api/cron/score
DATABASE_URL=                      # Direct Postgres URI (for bun scripts)
DALLAS_APP_TOKEN=                  # Socrata app token for Dallas 311 API
COURTLISTENER_TOKEN=               # API token for outbound party fetches
COURTLISTENER_WEBHOOK_SECRET=      # Bearer token checked on inbound webhook POSTs
```

---

## Key File Paths

```
app/
  layout.tsx                  # IBM Plex Sans + Mono fonts
  page.tsx                    # redirect → /leads
  leads/
    page.tsx                  # Lead list: hot leads + filter bar + paginated table
    _components/
      FilterBar.tsx           # 'use client' — type chips, absentee toggle, scored toggle
      HotLeads.tsx            # 'use client' — top 6 scored leads as cards
    [id]/page.tsx             # Property detail: owner, value, score, signals list
  auth/
    login/page.tsx            # Magic link form
    callback/route.ts         # Exchanges code → session → redirects to /leads
  api/
    skip-trace/[id]/route.ts  # Stubbed (not yet implemented)
    cron/score/route.ts       # Scoring cron — fetches signals, computes scores, upserts
    webhooks/
      courtlistener/route.ts  # CourtListener webhook receiver — BANKRUPTCY signals

lib/
  scoring.ts                  # Pure scoring algorithm + scoreBand() + SIGNAL_WEIGHTS
  courtlistener.ts            # fetchDebtorParties() + parseDebtorAddress()
  supabase/
    client.ts                 # createBrowserClient
    server.ts                 # createServerClient with cookies
    middleware.ts             # updateSession (used by middleware.ts root)

scripts/
  import-dcad.ts              # DCAD CSV → properties table
  import-dcad-values.ts       # DCAD values CSV → assessed_value column
  import-signals.ts           # SQLite pipeline DB → signals table
  refresh-signals.ts          # Dallas 311 Socrata API → signals table
  import-bankruptcy.ts        # CourtListener TXNB → BANKRUPTCY signals (one-time backfill)

types/index.ts                # Property, Signal, LeadScore, SignalType, OwnershipType, etc.
middleware.ts                 # Route protection (calls updateSession)
supabase/schema.sql           # Full DB schema
vercel.json                   # Cron config
```

---

## Design System

**Fonts:** IBM Plex Sans (UI text), IBM Plex Mono (scores, case numbers, data)

**CSS custom properties (globals.css):**
- Background: `--bg-base: #f8f7f5`, `--bg-surface: #ffffff`
- Text: `--text-primary: #0f0f0e`, `--text-secondary`, `--text-muted`
- Borders: `--border`
- Score badges: `--score-high-bg/text` (≥70), `--score-med-bg/text` (≥50), `--score-low-bg/text` (<50)
- Signal tags: divorce/NOD (red), code (amber), tax (blue), vacant (green), absentee (purple), trust (yellow), bankruptcy (orange)

---

## Testing

```bash
bun run test        # vitest run --passWithNoTests
bun run test:e2e    # playwright test --pass-with-no-tests
```

Test framework: Vitest (jsdom) + Playwright (chromium, baseURL localhost:3000)

---

## Known Gotchas

1. **`bun:sql` array serialization** — `unnest(${array}::text[])` fails with "malformed array literal". Use `sql.unsafe()` with manually escaped VALUES instead.

2. **`CREATE INDEX CONCURRENTLY` in Supabase SQL editor** — editor wraps in a transaction; CONCURRENTLY is not allowed. Remove the `CONCURRENTLY` keyword when running in the editor.

3. **`scripts/` in tsconfig.json** — must be in `exclude` array to prevent Next.js TS check from failing on `bun:sql` / `bun:sqlite` imports.

4. **`unstable_cache` + `cookies()`** — cannot call `cookies()` inside a cached function. Use `adminClient()` (service role, no cookies) for all cacheable fetches.

5. **Stale `unstable_cache`** — delete `.next/cache` directory to bust cache during development when data changes aren't reflecting.

6. **Middleware naming** — `middleware.ts` (not `proxy.ts`) is required for Vercel. Next.js 16 locally prefers `proxy.ts` but Vercel requires the standard name. The local deprecation warning is safe to ignore.

---

## Pending Work

- [x] CourtListener webhook + bankruptcy signals (TXNB) — `/api/webhooks/courtlistener`
- [ ] Wire tax delinquency signals (DCAD2025_CURRENT has relevant files)
- [ ] Court filing scraper (divorce / probate filings)
- [ ] Lead status UI — `NEW → CONTACTED → SKIPPED` (table exists, no UI)
- [ ] Skip trace API (`/api/skip-trace/[id]` is stubbed)
- [ ] Automate daily signals refresh (currently manual `bun run refresh:signals`)
- [ ] Fix git committer identity (currently showing as `jaketrigg@MacBookPro.lan`)

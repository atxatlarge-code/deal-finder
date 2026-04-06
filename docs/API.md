# Deal Finder — API Documentation

## Table of Contents
- [External APIs](#-external-apis)
- [Internal API Routes](#-internal-api-routes)
- [Data Import Scripts](#-data-import-scripts)
- [Environment Variables](#-environment-variables)

---

## 📡 External APIs

### Dallas Open Data API (Socrata)

**Purpose:** Code violation signals from Dallas 311

| Detail | Value |
|--------|-------|
| Base URL | `https://www.dallasopendata.com` |
| Dataset | `gc4d-8a49` (311 Service Requests) |
| Auth | `X-App-Token` header (optional) |
| Env Var | `DALLAS_APP_TOKEN` |

**Full URL:**
```
https://www.dallasopendata.com/resource/gc4d-8a49.json?$where=update_date > '{date}' AND department = 'Code Compliance'&$limit=5000
```

**Script:**
```bash
bun scripts/refresh-signals.ts [--days N] [--dry-run]
```

---

### CourtListener / RECAP API

**Purpose:** Bankruptcy filing signals (TXNB — Texas Northern Bankruptcy)

| Detail | Value |
|--------|-------|
| Base URL | `https://www.courtlistener.com/api/rest/v4` |
| Auth | `Authorization: Token {token}` header |
| Env Var | `COURTLISTENER_TOKEN` |
| Docs | https://www.courtlistener.com/api/rest/v4/ |

**Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dockets/?court__id=txnb&date_filed__range={since},{end}` | Search TXNB bankruptcy dockets |
| GET | `/parties/?docket={docketId}` | Get parties for a docket |

**Script:**
```bash
bun scripts/import-bankruptcy.ts [--days-back N] [--dry-run] [--limit N]
```

---

### Supabase

**Purpose:** PostgreSQL database & authentication

| Detail | Value |
|--------|-------|
| URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Anon Key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser/client) |
| Service Key | `SUPABASE_SERVICE_ROLE_KEY` (server/scripts) |

---

## 🌐 Internal API Routes

### POST `/api/cron/score`

**Purpose:** Computes and stores lead scores for all properties with active signals.

**Auth:** Bearer token in Authorization header

```bash
curl -X POST https://your-domain.com/api/cron/score \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Request Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer {CRON_SECRET}` |

**Response (200 OK):**
```json
{
  "status": "ok",
  "scored": 150,
  "score_version": "v1",
  "scored_at": "2026-04-06T16:00:00.000Z"
}
```

**Response (401 Unauthorized):**
```json
{ "error": "Unauthorized" }
```

**Logic:**
1. Fetches all signals from last 180 days
2. Groups signals by property
3. Computes score using weighted signals + absentee/ownership bonuses
4. Inserts into `lead_scores` table (versioned — always inserts, never updates)

---

### POST `/api/webhooks/courtlistener`

**Purpose:** Receives real-time bankruptcy alerts from CourtListener.

**Auth:** Bearer token in Authorization header

```bash
curl -X POST https://your-domain.com/api/webhooks/courtlistener \
  -H "Authorization: Bearer $COURTLISTENER_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"search": {...}, "alert": {...}}'
```

**Request Headers:**
| Header | Value |
|--------|-------|
| Authorization | `Bearer {COURTLISTENER_WEBHOOK_SECRET}` |
| Content-Type | `application/json` |

**Response (200 OK):**
```json
{ "success": true, "message": "Signal logged and scoring triggered" }
```

**Response (500 Error):**
```json
{ "error": "Failed" }
```

**Logic:**
1. Logs raw event to `webhook_logs` table
2. Triggers `/api/cron/score` in background (fire-and-forget)
3. Returns immediately to avoid CourtListener timeout

---

### POST `/api/skip-trace/[id]`

**Status:** Stubbed — not yet implemented

**Purpose:** Skip trace integration for property owner contact info.

---

## 📜 Data Import Scripts

| Script | Source | Destination | Key Args |
|--------|--------|-------------|----------|
| `import-dcad.ts` | DCAD CSV | `properties` table | `--file [path]` |
| `import-dcad-values.ts` | DCAD values CSV | `assessed_value` column | `--file [path]` |
| `import-signals.ts` | SQLite pipeline DB | `signals` table | `--db [path]` |
| `refresh-signals.ts` | Dallas 311 API | `signals` table | `--days N`, `--dry-run` |
| `import-bankruptcy.ts` | CourtListener | `signals` table | `--days-back N`, `--dry-run`, `--limit N` |
| `fetch-bankruptcy.ts` | CourtListener | `bankruptcy_dockets` table | `--days N`, `--dry-run` |
| `match-bankruptcy.ts` | `bankruptcy_dockets` table | `signals` table | `--limit N`, `--dry-run`, `--re-match` |
| `import-life-events.ts` | Dallas County | `signals` table | — |

### Usage Examples

```bash
# Import DCAD property data
bun scripts/import-dcad.ts --file /path/to/dcad_account.csv

# Import DCAD assessed values
bun scripts/import-dcad-values.ts --file /path/to/ACCOUNT_APPRL_YEAR.csv

# Import signals from SQLite pipeline DB
bun scripts/import-signals.ts --db /path/to/pipeline.db

# Refresh code violations from Dallas 311 (last 14 days)
bun scripts/refresh-signals.ts

# Refresh code violations with custom lookback
bun scripts/refresh-signals.ts --days 30 --dry-run
```

---

### Two-Phase Bankruptcy Workflow

The bankruptcy import is split into two separate scripts for flexibility:

#### Phase 1: Fetch Dockets
Pulls bankruptcy filings from CourtListener and stores them in `bankruptcy_dockets` table.

```bash
# Fetch last 14 days of TXNB bankruptcy filings
bun scripts/fetch-bankruptcy.ts --days 14

# Preview without writing
bun scripts/fetch-bankruptcy.ts --dry-run
```

#### Phase 2: Match to Properties
Matches stored dockets to properties using fuzzy name matching, then inserts into `signals`.

```bash
# Match all unmatched dockets
bun scripts/match-bankruptcy.ts

# Preview matches without writing signals
bun scripts/match-bankruptcy.ts --dry-run

# Re-match already-processed dockets
bun scripts/match-bankruptcy.ts --re-match

# Limit processing
bun scripts/match-bankruptcy.ts --limit 50
```

#### Workflow Example

```bash
# 1. Daily: Fetch new dockets from CourtListener
bun scripts/fetch-bankruptcy.ts --days 1

# 2. After fetch: Match dockets to properties
bun scripts/match-bankruptcy.ts

# 3. After match: Re-score properties with new signals
curl -X POST https://your-domain.com/api/cron/score \
  -H "Authorization: Bearer $CRON_SECRET"
```

**Benefits:**
- Separate API calls from database matching
- Re-run matching logic without hitting CourtListener
- Easier to debug which step fails
- More flexible scheduling

---

## 🔑 Environment Variables

### Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Cron Auth (shared secret for /api/cron/score)
CRON_SECRET=your-random-secret
```

### Optional

```bash
# Dallas Open Data API (Socrata) — get from https://www.dallasopendata.com/profile
DALLAS_APP_TOKEN=your-socrata-token

# CourtListener API — get from https://www.courtlistener.com
COURTLISTENER_TOKEN=your-courtlistener-api-token
COURTLISTENER_WEBHOOK_SECRET=your-webhook-secret

# Site URL for internal webhook scoring trigger
NEXT_PUBLIC_SITE_URL=https://your-domain.com
```

---

## Database Schema Reference

### Tables

| Table | Description |
|-------|-------------|
| `properties` | ~680K Dallas County parcels with owner/address/value |
| `signals` | Distress signals linked to properties (violations, bankruptcies, etc.) |
| `lead_scores` | Versioned scores (refreshed weekly) |
| `lead_status` | Per-user lead tracking (NEW/CONTACTED/SKIPPED) |
| `bankruptcy_dockets` | Raw bankruptcy dockets from CourtListener (matched separately) |
| `webhook_logs` | Raw CourtListener webhook events |

### Signal Types

| Type | Weight | Description |
|------|--------|-------------|
| `FORECLOSURE` | 40 pts | Foreclosure filings |
| `DIVORCE` | 35 pts | Divorce filings |
| `BANKRUPTCY` | 35 pts | Bankruptcy filings |
| `TAX_DELINQUENCY` | 30 pts | Tax delinquency |
| `CODE_VIOLATION` | 20 pts | Code compliance violations |
| `VACANT` | 15 pts | Vacant property |
| `EMERGENCY` | +100 pts | Emergency substandard structure |

---

## Scoring Algorithm

```
Score = min(100, round((base + absentee_bonus) × ownership_multiplier))

Base: Sum of signal weights
Absentee bonus: +15 pts (mailing ≠ property address)
Ownership multiplier: ESTATE 1.2 › TRUST 1.15 › LLC 1.1 › INDIVIDUAL 1.0

Score bands:
  ≥70 = High (black badge)
  ≥50 = Medium (gray badge)
  <50 = Low (muted badge)
```

---

## Script Best Practices

These patterns should be followed when writing new data import scripts.

### 1. Two-Phase Architecture

Separate scripts into **fetch** (API calls) and **process** (database writes):

| Phase | Responsibility | Example |
|-------|----------------|---------|
| Fetch | Call external APIs, store raw data | `fetch-bankruptcy.ts` → `bankruptcy_dockets` |
| Process | Read stored data, match to entities | `match-bankruptcy.ts` → `signals` |

**Benefits:**
- Re-run processing without re-fetching from APIs
- Separate scheduling (e.g., fetch daily, process weekly)
- Easier debugging — know which step failed

### 2. CLI Interface Standards

Support consistent flags across all scripts:

| Flag | Description | Example |
|------|-------------|---------|
| `--days N` | Lookback period in days | `--days 30` |
| `--dry-run` | Preview without writing | `--dry-run` |
| `--limit N` | Cap processed records | `--limit 100` |
| `--re-match` | Re-process already-processed | `--re-match` |

### 3. Live Progress Output

Print status in real-time so users can see what's happening:

```typescript
console.log('  Fetching: /dockets/?court__id=txnb...')  // API call start
console.log(`  ✓ MATCH: "${caseName}" → "${ownerName}"`)  // Success
console.log(`  — No match: "${caseName}"`)  // No match
console.log(`  [${processed}] processed, ${matched} matched...`)  // Progress
```

### 4. Summary Stats

Always print final statistics at completion:

```typescript
console.log('')
console.log('--- Summary ---')
console.log(`  Dockets processed: ${processed}`)
console.log(`  Matched:          ${matched}`)
console.log(`  Skipped:          ${skipped}`)
console.log(`  Errors:           ${errors}`)
```

### 5. Error Resilience

Don't fail on individual errors — track and report:

```typescript
let errors = 0
try {
  await processItem(item)
} catch (err) {
  console.error(`  Error processing ${item.id}:`, err)
  errors++
}
// At end: console.log(`Errors: ${errors}`)
```

### 6. Duplicate Handling

Check for existing records before inserting:

```typescript
const existing = await sql`SELECT id FROM table WHERE unique_key = ${key}`
if (existing.length > 0) {
  skipped++
  continue
}
```

### 7. Batch Insertions

For bulk inserts, batch in chunks of 500:

```typescript
for (let i = 0; i < rows.length; i += 500) {
  await sql`INSERT INTO table ... VALUES ${rows.slice(i, i + 500)}`
}
```

---

## Quick Reference

### Running Scripts

```bash
cd my-ai-app

# Data imports
bun scripts/import-dcad.ts --file data.csv
bun scripts/import-dcad-values.ts --file values.csv
bun scripts/refresh-signals.ts --days 14

# Bankruptcy workflow
bun scripts/fetch-bankruptcy.ts --days 30      # Phase 1: fetch
bun scripts/match-bankruptcy.ts                 # Phase 2: match
bun scripts/match-bankruptcy.ts --dry-run      # Preview

# Scoring
curl -X POST https://your-domain.com/api/cron/score \
  -H "Authorization: Bearer $CRON_SECRET"
```

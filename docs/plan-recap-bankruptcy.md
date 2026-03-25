# Plan: RECAP Bankruptcy Signals via CourtListener API

## Overview

Integrate [CourtListener](https://www.courtlistener.com/api/rest/v4/) (RECAP Project) to pull
Chapter 7 and Chapter 13 bankruptcy filings from the **Northern District of Texas** (court code
`txnb`), match debtors to Dallas County properties, and create `BANKRUPTCY` signals that feed
the scoring engine.

**Why RECAP over PACER:** Free (5,000 req/hr authenticated), structured JSON API, debtor
addresses included in party records.

**Preferred ingestion:** Webhooks (Search Alert events) for real-time new filings + one-time
bulk import script for historical backfill. Webhooks eliminate cron polling entirely.

**Coverage caveat:** RECAP only has cases that PACER users have previously fetched via the
RECAP browser extension — not 100% of filings. In practice, high-volume districts like TXNB
have good coverage (~60-80%) but it is not exhaustive. For complete coverage, PACER would be
needed at $0.10/page.

---

## API Overview

**Base URL:** `https://www.courtlistener.com/api/rest/v4/`
**Auth:** Token in `Authorization: Token <token>` header (register free at courtlistener.com)
**Rate limit:** 5,000 requests/hour (authenticated)

### Key endpoints

| Endpoint | Purpose |
|---|---|
| `/dockets/` | Case docket records — case number, title, filing date, chapter |
| `/parties/` | Debtor/creditor parties — name, address, role |
| `/bankruptcy-information/` | Chapter, assets, liabilities, trustee info per docket |

### Useful docket filters
```
court=txnb                    # Northern District of Texas (Dallas division)
date_filed__gte=2024-01-01    # Filed after date
nature_of_suit=...            # Not relevant for bankruptcy (use chapter instead)
```

### Party record fields
```json
{
  "name": "JOHN SMITH",
  "date_terminated": null,
  "extra_info": "2847 ELM ST, DALLAS, TX 75201",
  "party_types": [{"docket": "...", "name": "Debtor"}],
  "attorneys": [...]
}
```

The `extra_info` field contains the debtor's address as a raw string — requires parsing.

---

## Data Model

### New signal type

Add `BANKRUPTCY` to the `SignalType` enum in `types/index.ts`:
- Weight: **35 pts** (same tier as DIVORCE — both are severe financial distress)
- Signal tag color: **orange** (distinct from existing types)

### signals table

No schema change needed — existing `signals` table handles it:
```
signal_type  = 'BANKRUPTCY'
case_number  = CourtListener docket ID (e.g. 'txnb-24-30001')
description  = 'Chapter 7 Bankruptcy — Filed 2024-03-15'
source_url   = 'https://www.courtlistener.com/docket/12345/'
filed_at     = docket.date_filed
```

---

## Matching Strategy

Bankruptcy records contain a debtor address in `party.extra_info` as a raw string
(e.g. `"2847 ELM ST, DALLAS, TX 75201"`). Matching flow:

1. **Parse address** — extract street number + street name from `extra_info`
2. **Exact match** — `UPPER(property_address) = UPPER(parsed_address)`
3. **Prefix fallback** — first 10 chars of normalized street address
4. **Owner name match** (secondary) — fuzzy match debtor name against `owner_name` where
   `ownership_type = 'INDIVIDUAL'`

Expected match rate: ~30-40% (addresses in court records are often mailing addresses,
not property addresses — same limitation as existing code violations import).

---

## Implementation Plan

### 1. Register CourtListener account + add env var

```bash
COURTLISTENER_TOKEN=    # Add to .env.local and Vercel env vars
```

### 2. Create `scripts/import-bankruptcy.ts`

```typescript
// bun scripts/import-bankruptcy.ts
// Fetches TXNB bankruptcy filings filed in the last N days, matches to properties,
// upserts signals

import sql from 'bun:sql'

const BASE = 'https://www.courtlistener.com/api/rest/v4'
const TOKEN = process.env.COURTLISTENER_TOKEN

async function fetchDockets(daysBack = 90) {
  const since = new Date(Date.now() - daysBack * 86400_000)
    .toISOString().slice(0, 10)

  const url = `${BASE}/dockets/?court=txnb&date_filed__gte=${since}&order_by=-date_filed&page_size=100`
  // Paginate through results...
}

async function fetchParties(docketId: string) {
  // GET /parties/?docket=<id>&name=Debtor
  // Returns debtor name + extra_info (address)
}

function parseAddress(extraInfo: string): string | null {
  // Parse "2847 ELM ST, DALLAS, TX 75201" → "2847 ELM ST"
}

async function matchProperty(address: string, ownerName: string) {
  // Exact match then prefix fallback
}
```

### 3. Add `BANKRUPTCY` to scoring engine (`lib/scoring.ts`)

```typescript
export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  FORECLOSURE: 40,
  DIVORCE: 35,
  BANKRUPTCY: 35,     // add this
  TAX_DELINQUENCY: 30,
  CODE_VIOLATION: 20,
  VACANT: 15,
}
```

### 4. Update `types/index.ts`

```typescript
export type SignalType =
  | 'FORECLOSURE'
  | 'DIVORCE'
  | 'BANKRUPTCY'      // add this
  | 'TAX_DELINQUENCY'
  | 'CODE_VIOLATION'
  | 'VACANT'
```

### 5. Update UI signal tags (`globals.css` + property detail page)

Add orange badge for BANKRUPTCY in the design token set.

### 6. Create webhook receiver `app/api/webhooks/courtlistener/route.ts`

CourtListener POSTs a `search.alert.recap` event whenever a new docket matches a
saved search. This replaces the cron polling approach for ongoing ingestion.

```typescript
// POST /api/webhooks/courtlistener
// Receives Search Alert webhook, matches debtor to property, upserts signal

export async function POST(request: Request) {
  const body = await request.json()

  // Verify webhook signature (CourtListener sends HMAC-SHA256 in header)
  // event type: body.webhook.event_type === 'search.alert.recap'

  const results = body.payload.results   // array of new docket matches
  for (const docket of results) {
    // fetch parties for this docket, parse address, match, upsert signal
  }

  return Response.json({ ok: true })
}
```

**Webhook setup (one-time, via CourtListener UI):**
1. Go to Profile → Webhooks → Add webhook
2. URL: `https://your-app.vercel.app/api/webhooks/courtlistener`
3. Event type: **Search Alert**
4. Create a saved RECAP search for `court:txnb` (optionally filter `type:r chapter:7 OR chapter:13`)
5. Link the saved search to the webhook

**Result:** New TXNB bankruptcy filings trigger a POST to our app within minutes of
CourtListener indexing them. No polling, no rate limit concerns for ongoing use.

---

## Pagination

CourtListener returns paginated results with a `next` URL:
```json
{
  "count": 4832,
  "next": "https://www.courtlistener.com/api/rest/v4/dockets/?...&cursor=xxx",
  "results": [...]
}
```

Use cursor-based pagination. At 100 results/page and 5,000 req/hr limit, fetching
4,800 dockets + their parties = ~100 docket pages + ~4,800 party pages = needs batching
over multiple cron runs or a one-time bulk import approach.

**Recommended:** One-time bulk import for historical data (90 days), then rolling 14-day
refresh in cron.

---

## Rate Limit Budget

| Operation | Requests |
|---|---|
| 90 days of dockets (~5,000 cases, 100/page) | 50 req |
| Party fetch per docket (1 req each) | 5,000 req |
| **Total initial import** | ~5,050 req (just over 1 hour limit) |
| **Rolling 14-day cron** | ~200 dockets + parties = ~400 req |

Initial import needs to run across 2 hours or implement a checkpoint/resume mechanism.

---

## Open Questions

1. **Address parse quality** — `extra_info` format is inconsistent. May need to test
   against real data before committing to this approach.
2. **Dallas division filter** — TXNB covers multiple divisions (Dallas, Fort Worth, Abilene,
   Lubbock, Wichita Falls). Need to confirm if `court=txnb` returns all or if there's a
   division filter to narrow to Dallas cases only.
3. **Chapter filter** — Chapter 7 (liquidation) and 13 (wage earner plan) are most relevant
   for motivated sellers. Chapter 11 (business reorganization) less so. Needs a
   `bankruptcy_information__chapter` filter.
4. **RECAP coverage gaps** — For a paid upgrade path, PACER direct access or a service
   like UniCourt/CourtAPI provides complete coverage.

---

## Files to Create/Modify

| File | Action |
|---|---|
| `scripts/import-bankruptcy.ts` | Create — bulk historical import (one-time) |
| `app/api/webhooks/courtlistener/route.ts` | Create — webhook receiver for ongoing ingestion |
| `lib/scoring.ts` | Add BANKRUPTCY weight |
| `types/index.ts` | Add BANKRUPTCY to SignalType |
| `app/leads/[id]/page.tsx` | Add orange BANKRUPTCY signal tag |
| `app/globals.css` | Add `--signal-bankruptcy-*` CSS vars |
| `.env.local` | Add COURTLISTENER_TOKEN |
| `CLAUDE.md` | Document new signal type and script |

---

## Score Impact Estimate

If 30% of ~5,000 TXNB filings in last 90 days match Dallas County properties,
that's ~1,500 new BANKRUPTCY signals. Combined with existing CODE_VIOLATION signals,
this meaningfully expands the scored lead pool.

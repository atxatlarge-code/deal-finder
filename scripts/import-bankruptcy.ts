#!/usr/bin/env bun
/**
 * One-time historical backfill: imports TXNB bankruptcy filings from
 * CourtListener into the signals table.
 *
 * Usage:
 *   bun scripts/import-bankruptcy.ts [--days-back 90] [--dry-run] [--limit N]
 *
 * Cursor-paginates over dockets, fetches debtor parties, matches to Dallas
 * County properties, and upserts BANKRUPTCY signals.
 * Prints progress every 100 dockets so it can be interrupted and resumed
 * by adjusting --days-back.
 */

import { sql } from 'bun'
import { fetchDebtorParties, parseDebtorAddress } from '../lib/courtlistener'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const daysBack = (() => {
  const idx = args.indexOf('--days-back')
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 90
})()
const limitArg = args.indexOf('--limit')
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Docket {
  id: number
  docket_number: string
  absolute_url: string
  date_filed: string
  case_name: string
  bankruptcy_information?: {
    chapter: string
  } | null
}

interface DocketListResponse {
  count: number
  next: string | null
  results: Docket[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = 'https://www.courtlistener.com/api/rest/v4'

function clHeaders(): Record<string, string> {
  const token = process.env.COURTLISTENER_TOKEN
  const h: Record<string, string> = { Accept: 'application/json' }
  if (token) h['Authorization'] = `Token ${token}`
  return h
}

function esc(s: string | null): string {
  if (s === null) return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}

/**
 * Match a street address to a property_id via direct Postgres queries.
 * Exact UPPER() match first; prefix 10-char fallback.
 */
async function matchProperty(address: string): Promise<string | null> {
  const upper = address.toUpperCase()

  const exact = await sql.unsafe<{ id: string }[]>(`
    SELECT id FROM properties
    WHERE UPPER(property_address) = ${esc(upper)}
    LIMIT 1
  `)
  if (exact[0]) return exact[0].id

  const prefix = upper.slice(0, 10)
  const prefixRows = await sql.unsafe<{ id: string }[]>(`
    SELECT id FROM properties
    WHERE LEFT(UPPER(property_address), 10) = ${esc(prefix)}
    ORDER BY property_address
    LIMIT 1
  `)
  return prefixRows[0]?.id ?? null
}

async function upsertSignal(
  propertyId: string,
  docket: Docket,
): Promise<void> {
  const chapter = docket.bankruptcy_information?.chapter
  const description = chapter ? `Chapter ${chapter} Bankruptcy` : 'Bankruptcy'
  const sourceUrl = `https://www.courtlistener.com${docket.absolute_url}`
  const rawData = JSON.stringify(docket).replace(/'/g, "''")

  await sql.unsafe(`
    INSERT INTO signals (id, property_id, signal_type, source, case_number, filed_at, description, source_url, raw_data, created_at)
    VALUES (
      gen_random_uuid(),
      ${esc(propertyId)},
      'BANKRUPTCY',
      'CourtListener/RECAP',
      ${esc(docket.docket_number)},
      ${esc(docket.date_filed)},
      ${esc(description)},
      ${esc(sourceUrl)},
      '${rawData}'::jsonb,
      now()
    )
    ON CONFLICT (case_number) WHERE case_number IS NOT NULL DO NOTHING
  `)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Bankruptcy backfill — CourtListener TXNB')
  console.log(`  Days back: ${daysBack}`)
  if (dryRun) console.log('  DRY RUN — no DB writes')
  if (limit !== Infinity) console.log(`  Limit: ${limit} dockets`)
  console.log('')

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10) // YYYY-MM-DD

  let nextUrl: string | null =
    `${BASE}/dockets/?court=txnb&date_filed__gte=${since}&order_by=date_filed&page_size=100`

  let totalDockets = 0
  let matched = 0
  let skipped = 0
  let errors = 0

  while (nextUrl && totalDockets < limit) {
    const res = await fetch(nextUrl, { headers: clHeaders() })
    if (!res.ok) {
      console.error(`Fetch error: ${res.status} ${res.statusText}`)
      break
    }
    const page: DocketListResponse = await res.json()

    for (const docket of page.results) {
      if (totalDockets >= limit) break
      totalDockets++

      let parties
      try {
        parties = await fetchDebtorParties(docket.id)
      } catch (err) {
        console.error(`  Docket ${docket.id} parties error:`, err)
        errors++
        continue
      }

      let docketMatched = false
      for (const party of parties) {
        const address = parseDebtorAddress(party.extra_info)
        if (!address) continue

        const propertyId = dryRun ? null : await matchProperty(address)

        if (dryRun) {
          console.log({
            docket_number: docket.docket_number,
            date_filed: docket.date_filed,
            debtor: party.name,
            address,
          })
          matched++
          docketMatched = true
          continue
        }

        if (!propertyId) {
          skipped++
          continue
        }

        try {
          await upsertSignal(propertyId, docket)
          matched++
          docketMatched = true
        } catch (err) {
          console.error(`  Signal upsert error for ${docket.docket_number}:`, err)
          errors++
        }
      }

      if (!docketMatched && !dryRun) skipped++

      // Progress checkpoint every 100 dockets
      if (totalDockets % 100 === 0) {
        console.log(`  [${totalDockets}] matched: ${matched}, skipped: ${skipped}, errors: ${errors}`)
      }
    }

    nextUrl = page.next
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`  Dockets processed: ${totalDockets}`)
  console.log(`  Matched:           ${matched}`)
  console.log(`  Skipped:           ${skipped}`)
  console.log(`  Errors:            ${errors}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

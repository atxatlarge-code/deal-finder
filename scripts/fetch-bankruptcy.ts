#!/usr/bin/env bun
/**
 * Phase 1: Fetch bankruptcy dockets from CourtListener
 * Stores raw docket data in bankruptcy_dockets table for later matching.
 * 
 * Usage:
 *   bun scripts/fetch-bankruptcy.ts                 # Fetch last 90 days
 *   bun scripts/fetch-bankruptcy.ts --days 30      # Custom days back
 *   bun scripts/fetch-bankruptcy.ts --dry-run       # Preview without writing
 */

import { sql } from 'bun'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const daysBack = (() => {
  const idx = args.indexOf('--days')
  return idx !== -1 ? parseInt(args[idx + 1], 10) : 90
})()

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

function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🔍 Fetch Bankruptcy Dockets — CourtListener TXNB')
  console.log(`  Days back: ${daysBack}`)
  if (dryRun) console.log('  DRY RUN — Not writing to database')
  console.log('')

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  let nextUrl: string | null =
    `${BASE}/dockets/?court__id=txnb&date_filed__range=${since},2099-01-01&page_size=20`

  let totalDockets = 0
  let inserted = 0
  let skipped = 0
  let errors = 0

  while (nextUrl) {
    console.log(`  Fetching: ${nextUrl.replace(BASE, '')}`)
    const res = await fetch(nextUrl, { headers: clHeaders() })

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'No error body')
      console.error(`  Fetch error: ${res.status} ${res.statusText}`)
      console.error(`  Details: ${errorText.slice(0, 200)}`)
      break
    }

    const page: DocketListResponse = await res.json()

    for (const docket of page.results) {
      totalDockets++

      // Skip if already exists
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM bankruptcy_dockets WHERE docket_number = ${docket.docket_number}
      `

      if (existing.length > 0) {
        skipped++
        continue
      }

      // Build the row
      const chapter = docket.bankruptcy_information?.chapter || null
      const sourceUrl = `https://www.courtlistener.com${docket.absolute_url}`
      const rawData = JSON.stringify(docket).replace(/'/g, "''")

      if (!dryRun) {
        try {
          await sql.unsafe(`
            INSERT INTO bankruptcy_dockets (
              id, docket_number, case_name, court, date_filed, chapter,
              source_url, raw_data, created_at
            ) VALUES (
              gen_random_uuid(),
              ${esc(docket.docket_number)},
              ${esc(docket.case_name)},
              'txnb',
              ${esc(docket.date_filed)},
              ${esc(chapter)},
              ${esc(sourceUrl)},
              '${rawData}'::jsonb,
              now()
            )
          `)
          inserted++
        } catch (err) {
          console.error(`  Error inserting ${docket.docket_number}:`, err)
          errors++
        }
      }
    }

    nextUrl = page.next

    if (totalDockets % 100 === 0 && totalDockets > 0) {
      console.log(`  [${totalDockets}] processed, ${inserted} new, ${skipped} duplicate, ${errors} errors`)
    }
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`  Dockets fetched:  ${totalDockets}`)
  console.log(`  New records:      ${inserted}`)
  console.log(`  Skipped (dupes):  ${skipped}`)
  console.log(`  Errors:           ${errors}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

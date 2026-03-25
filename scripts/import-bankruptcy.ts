#!/usr/bin/env bun
/**
 * One-time historical backfill: imports TXNB bankruptcy filings from
 * CourtListener into the signals table.
 * * FUZZY MATCH VERSION: Strips suffixes like LLC/INC to increase match rates.
 */

import { sql } from 'bun'

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
 * Fuzzy Match: Normalizes names to increase hit rates in the properties table.
 */
async function matchPropertyByOwner(name: string): Promise<string | null> {
  // 1. Clean the name: Upper case, remove punctuation, strip common entity suffixes
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '') // Remove everything except letters, numbers, and spaces
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|PLC|COMPANY|CO)\b/g, '')
    .trim();

  // If the name is too short after cleaning (like "A LLC"), skip to avoid false positives
  if (clean.length < 3) return null;

  // 2. Search for the cleaned "base name" within your owner_name column
  const row = await sql.unsafe<{ id: string, owner_name: string }[]>(`
    SELECT id, owner_name FROM properties
    WHERE UPPER(owner_name) ILIKE ${esc('%' + clean + '%')}
    LIMIT 1
  `);
  
  if (row[0]) {
    console.log(`    ✓ MATCHED: "${name}" matches DB owner "${row[0].owner_name}"`);
    return row[0].id;
  }
  return null;
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
  console.log('Bankruptcy backfill — CourtListener TXNB (Fuzzy Mode)')
  console.log(`  Days back: ${daysBack}`)
  if (dryRun) console.log('  DRY RUN — Checking DB for matches but not writing signals')
  if (limit !== Infinity) console.log(`  Limit: ${limit} dockets`)
  console.log('')

  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  let nextUrl: string | null =
    `${BASE}/dockets/?court__id=txnb&date_filed__range=${since},2099-01-01&page_size=20`

  let totalDockets = 0
  let matched = 0
  let skipped = 0
  let errors = 0

  while (nextUrl && totalDockets < limit) {
    console.log(`  Fetching page: ${nextUrl}`);
    const res = await fetch(nextUrl, { headers: clHeaders() })
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'No error body');
      console.error(`Fetch error: ${res.status} ${res.statusText}`);
      console.error(`Details: ${errorText.slice(0, 500)}`);
      break
    }
    
    const page: DocketListResponse = await res.json()

    for (const docket of page.results) {
      if (totalDockets >= limit) break
      totalDockets++

      const debtorName = docket.case_name;
      
      // We check the database even in Dry Run to verify matching logic
      const propertyId = await matchPropertyByOwner(debtorName);

      if (propertyId) {
        matched++;
        if (!dryRun) {
          try {
            await upsertSignal(propertyId, docket);
          } catch (err) {
            console.error(`  Error upserting ${docket.docket_number}:`, err);
            errors++;
          }
        }
      } else {
        skipped++;
      }

      if (totalDockets % 100 === 0) {
        console.log(`  [${totalDockets}] found: ${totalDockets}, matched in DB: ${matched}, skipped: ${skipped}`)
      }
    }

    nextUrl = page.next
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`  Dockets processed: ${totalDockets}`)
  console.log(`  Matched in DB:     ${matched}`)
  console.log(`  Skipped:           ${skipped}`)
  console.log(`  Errors:            ${errors}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
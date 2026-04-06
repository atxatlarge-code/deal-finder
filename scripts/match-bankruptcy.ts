#!/usr/bin/env bun
/**
 * Phase 2: Match bankruptcy dockets to properties
 * Reads from bankruptcy_dockets table, fuzzy-matches case_name to owner_name,
 * and inserts matched signals into the signals table.
 * 
 * Usage:
 *   bun scripts/match-bankruptcy.ts                  # Match all unmatched dockets
 *   bun scripts/match-bankruptcy.ts --limit 100     # Limit processing
 *   bun scripts/match-bankruptcy.ts --dry-run        # Preview matches without writing
 *   bun scripts/match-bankruptcy.ts --re-match       # Re-match already-matched dockets
 */

import { sql } from 'bun'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.indexOf('--limit')
const limit = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : Infinity
const reMatch = args.includes('--re-match')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL'
  return `'${String(s).replace(/'/g, "''")}'`
}

/**
 * Fuzzy Match: Normalizes names to increase hit rates in the properties table.
 * Strips suffixes like LLC/INC to increase match rates.
 */
async function matchPropertyByOwner(name: string): Promise<{ id: string; owner_name: string } | null> {
  // 1. Clean the name: Upper case, remove punctuation, strip common entity suffixes
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '') // Remove everything except letters, numbers, and spaces
    .replace(/\b(LLC|L L C|INC|INCORPORATED|CORP|CORPORATION|LTD|LIMITED|LP|PLC|COMPANY|CO)\b/g, '')
    .trim()

  // If the name is too short after cleaning (like "A LLC"), skip to avoid false positives
  if (clean.length < 3) return null

  // 2. Search for the cleaned "base name" within your owner_name column
  const row = await sql<{ id: string; owner_name: string }[]>`
    SELECT id, owner_name FROM properties
    WHERE UPPER(owner_name) LIKE ${'%' + clean + '%'}
    LIMIT 1
  `

  if (row[0]) {
    return { id: row[0].id, owner_name: row[0].owner_name }
  }
  return null
}

/**
 * Check if a docket has already been matched
 */
async function isAlreadyMatched(docketNumber: string): Promise<boolean> {
  const existing = await sql<{ id: string }[]>`
    SELECT id FROM signals WHERE case_number = ${docketNumber}
  `
  return existing.length > 0
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('🎯 Match Bankruptcy Dockets to Properties')
  if (dryRun) console.log('  DRY RUN — Not writing signals')
  if (reMatch) console.log('  Re-matching already-matched dockets')
  if (limit !== Infinity) console.log(`  Limit: ${limit} dockets`)
  console.log('')

  // Fetch unmatched dockets from the bankruptcy_dockets table
  let query = sql`
    SELECT id, docket_number, case_name, court, date_filed, chapter, source_url
    FROM bankruptcy_dockets
    ORDER BY date_filed DESC
  `

  if (!reMatch) {
    // Filter out already-matched dockets
    query = sql`
      SELECT d.id, d.docket_number, d.case_name, d.court, d.date_filed, d.chapter, d.source_url
      FROM bankruptcy_dockets d
      LEFT JOIN signals s ON s.case_number = d.docket_number
      WHERE s.id IS NULL
      ORDER BY d.date_filed DESC
    `
  }

  const dockets = await query

  let processed = 0
  let matched = 0
  let skipped = 0
  let errors = 0

  for (const docket of dockets) {
    if (processed >= limit) break
    processed++

    // Check if already matched (in case of re-run without --re-match)
    if (!reMatch) {
      const alreadyMatched = await isAlreadyMatched(docket.docket_number)
      if (alreadyMatched) {
        skipped++
        continue
      }
    }

    // Try to match the case name to a property
    const property = await matchPropertyByOwner(docket.case_name)

    if (property) {
      console.log(`  ✓ MATCH: "${docket.case_name}" → "${property.owner_name}" (${docket.docket_number})`)
      matched++

      if (!dryRun) {
        try {
          const chapter = docket.chapter || null
          const description = chapter ? `Chapter ${chapter} Bankruptcy` : 'Bankruptcy'

          await sql.unsafe(`
            INSERT INTO signals (id, property_id, signal_type, source, case_number, filed_at, description, source_url, created_at)
            VALUES (
              gen_random_uuid(),
              ${esc(property.id)},
              'BANKRUPTCY',
              'CourtListener/RECAP',
              ${esc(docket.docket_number)},
              ${esc(docket.date_filed)},
              ${esc(description)},
              ${esc(docket.source_url)},
              now()
            )
          `)
        } catch (err) {
          console.error(`  Error inserting signal for ${docket.docket_number}:`, err)
          errors++
        }
      }
    } else {
      skipped++
      console.log(`  — No match: "${docket.case_name}"`)
    }

    if (processed % 50 === 0) {
      console.log(`  [${processed}] processed, ${matched} matched, ${skipped} skipped, ${errors} errors`)
    }
  }

  console.log('')
  console.log('--- Summary ---')
  console.log(`  Dockets processed: ${processed}`)
  console.log(`  Matched:          ${matched}`)
  console.log(`  Skipped:          ${skipped}`)
  console.log(`  Errors:           ${errors}`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})

#!/usr/bin/env bun
/**
 * One-time import: loads raw_violations from the SQLite pipeline DB into Supabase signals.
 *
 * Usage:
 *   bun scripts/import-signals.ts [--dry-run] [--limit N]
 */

import { Database } from "bun:sqlite"
import { sql } from "bun"

const SQLITE_PATH =
  "/Users/jaketrigg/Documents/Products/Deal Finder/dallas-re-pipeline/data/dallas_re.db"

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const limitArg = args[args.indexOf("--limit") + 1]
const limit = limitArg ? parseInt(limitArg, 10) : Infinity

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawViolation {
  service_request_id: string
  address: string
  violation_type: string
  created_date: string
  updated_date: string
  raw_json: string | null
}

interface SignalRow {
  property_id: string
  signal_type: string
  source: string
  case_number: string
  filed_at: string
  raw_data: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(s: string | null): string {
  if (s === null) return "NULL"
  return `'${s.replace(/'/g, "''")}'`
}

// Build a property_address → id map for a set of addresses.
// Tries exact match first; falls back to first-10-chars prefix match (same
// strategy as the Python pipeline's SUBSTR join).
async function lookupPropertyIds(addresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (addresses.length === 0) return map

  // Exact match pass
  const inList = addresses.map(a => esc(a.toUpperCase())).join(",")
  const exactRows = await sql.unsafe<{ id: string; property_address: string }[]>(`
    SELECT id, UPPER(property_address) AS property_address
    FROM properties
    WHERE UPPER(property_address) IN (${inList})
  `)
  for (const row of exactRows) {
    map.set(row.property_address, row.id)
  }

  // Prefix-match pass for unresolved addresses
  const unresolved = addresses.filter(a => !map.has(a.toUpperCase()))
  if (unresolved.length > 0) {
    const prefixes = [...new Set(unresolved.map(a => a.toUpperCase().slice(0, 10)))]
    const prefixList = prefixes.map(esc).join(",")
    const prefixRows = await sql.unsafe<{ id: string; property_address: string }[]>(`
      SELECT DISTINCT ON (LEFT(UPPER(property_address), 10))
        id, UPPER(property_address) AS property_address
      FROM properties
      WHERE LEFT(UPPER(property_address), 10) IN (${prefixList})
      ORDER BY LEFT(UPPER(property_address), 10), property_address
    `)
    for (const row of prefixRows) {
      const prefix = row.property_address.slice(0, 10)
      // Only fill gaps — don't overwrite exact matches
      for (const addr of unresolved) {
        if (addr.toUpperCase().startsWith(prefix) && !map.has(addr.toUpperCase())) {
          map.set(addr.toUpperCase(), row.id)
        }
      }
    }
  }

  return map
}

async function upsertBatch(batch: SignalRow[]): Promise<void> {
  const rows = batch
    .map(s =>
      `(gen_random_uuid(),${esc(s.property_id)},'CODE_VIOLATION',${esc(s.source)},${esc(s.case_number)},${esc(s.filed_at)},${s.raw_data ? `'${s.raw_data.replace(/'/g, "''")}'::jsonb` : "NULL"},now())`
    )
    .join(",")

  await sql.unsafe(`
    INSERT INTO signals (id, property_id, signal_type, source, case_number, filed_at, raw_data, created_at)
    VALUES ${rows}
    ON CONFLICT (case_number) WHERE case_number IS NOT NULL DO NOTHING
  `)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BATCH_SIZE = 200

async function main() {
  console.log("Signals import — reading from SQLite pipeline DB")
  if (dryRun) console.log("DRY RUN — no DB writes")
  if (limit !== Infinity) console.log(`Limit: ${limit}`)
  console.log("")

  const db = new Database(SQLITE_PATH, { readonly: true })

  const violations = db
    .query<RawViolation, []>(`
      SELECT service_request_id, address, violation_type, created_date, updated_date, raw_json
      FROM raw_violations
      WHERE address IS NOT NULL
      LIMIT ${limit === Infinity ? -1 : limit}
    `)
    .all()

  console.log(`  ${violations.length} violations in SQLite`)

  // Bulk-lookup property IDs
  const uniqueAddresses = [...new Set(violations.map(v => v.address.trim()))]
  console.log(`  ${uniqueAddresses.length} unique addresses — looking up property IDs...`)

  const propertyMap = await lookupPropertyIds(uniqueAddresses)
  console.log(`  ${propertyMap.size} addresses resolved to property IDs`)
  console.log("")

  let matched = 0
  let skipped = 0
  let errors = 0
  let batch: SignalRow[] = []

  for (const v of violations) {
    const propertyId = propertyMap.get(v.address.trim().toUpperCase())
    if (!propertyId) {
      skipped++
      continue
    }

    if (dryRun) {
      console.log({
        property_id: propertyId,
        case_number: v.service_request_id,
        violation_type: v.violation_type,
        filed_at: v.created_date,
      })
      matched++
      continue
    }

    batch.push({
      property_id: propertyId,
      signal_type: "CODE_VIOLATION",
      source: "Dallas 311",
      case_number: v.service_request_id,
      filed_at: v.created_date,
      raw_data: v.raw_json,
    })
    matched++

    if (batch.length >= BATCH_SIZE) {
      try {
        await upsertBatch(batch)
      } catch (err) {
        errors += batch.length
        console.error("Batch error:", err)
      }
      batch = []
    }
  }

  if (!dryRun && batch.length > 0) {
    try {
      await upsertBatch(batch)
    } catch (err) {
      errors += batch.length
      console.error("Final batch error:", err)
    }
  }

  console.log("--- Summary ---")
  console.log(`  Violations read:  ${violations.length}`)
  console.log(`  Matched:          ${matched}`)
  console.log(`  Skipped (no match): ${skipped}`)
  console.log(`  Errors:           ${errors}`)
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})

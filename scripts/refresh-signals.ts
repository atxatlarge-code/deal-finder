#!/usr/bin/env bun
/**
 * Daily signals refresh — fetches code violations from Dallas Open Data (Socrata)
 * and upserts into the Supabase signals table.
 *
 * Designed to be run on a schedule (cron, GitHub Actions, etc.).
 * Safe to re-run: ON CONFLICT (case_number) DO NOTHING skips duplicates.
 *
 * Usage:
 *   bun scripts/refresh-signals.ts [--days N] [--dry-run]
 */

import { sql } from "bun"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DALLAS_APP_TOKEN = process.env.DALLAS_APP_TOKEN
const SOCRATA_DOMAIN = "www.dallasopendata.com"
const DATASET_ID = "gc4d-8a49"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const daysArg = args[args.indexOf("--days") + 1]
const lookbackDays = daysArg ? parseInt(daysArg, 10) : 14

// ---------------------------------------------------------------------------
// Socrata fetch
// ---------------------------------------------------------------------------

interface SocrataViolation {
  service_request_number: string
  address: string
  zip_code?: string
  service_request_type: string
  outcome?: string
  description?: string
  priority?: string
  city_council_district?: string
  created_date: string
  update_date: string
  status?: string
  [key: string]: unknown
}

async function fetchViolations(): Promise<SocrataViolation[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)

  const params = new URLSearchParams({
    $where: `update_date > '${since}' AND department = 'Code Compliance'`,
    $limit: "5000",
    $order: "update_date DESC",
  })

  const url = `https://${SOCRATA_DOMAIN}/resource/${DATASET_ID}.json?${params}`
  const headers: Record<string, string> = { Accept: "application/json" }
  if (DALLAS_APP_TOKEN) headers["X-App-Token"] = DALLAS_APP_TOKEN

  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`Socrata API ${res.status}: ${await res.text()}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Property lookup (same prefix-match strategy as Python pipeline)
// ---------------------------------------------------------------------------

function esc(s: string | null): string {
  if (s === null) return "NULL"
  return `'${s.replace(/'/g, "''")}'`
}

async function lookupPropertyIds(addresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (addresses.length === 0) return map

  // Exact match
  const inList = addresses.map(a => esc(a.toUpperCase())).join(",")
  const exactRows = await sql.unsafe<{ id: string; property_address: string }[]>(`
    SELECT id, UPPER(property_address) AS property_address
    FROM properties
    WHERE UPPER(property_address) IN (${inList})
  `)
  for (const row of exactRows) map.set(row.property_address, row.id)

  // Prefix fallback
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
      for (const addr of unresolved) {
        if (addr.toUpperCase().startsWith(prefix) && !map.has(addr.toUpperCase())) {
          map.set(addr.toUpperCase(), row.id)
        }
      }
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

interface SignalRow {
  property_id: string
  case_number: string
  violation_type: string
  filed_at: string
  raw_data: string
}

async function upsertBatch(batch: SignalRow[]): Promise<void> {
  const rows = batch
    .map(s =>
      `(gen_random_uuid(),${esc(s.property_id)},'CODE_VIOLATION','Dallas 311',${esc(s.case_number)},${esc(s.filed_at)},'${s.raw_data.replace(/'/g, "''")}'::jsonb,now())`
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
  console.log(`Signals refresh — last ${lookbackDays} days from Dallas Open Data`)
  if (dryRun) console.log("DRY RUN — no DB writes")
  console.log("")

  const violations = await fetchViolations()
  console.log(`  Fetched ${violations.length} violations from Socrata`)

  const uniqueAddresses = [...new Set(violations.map(v => v.address?.trim()).filter(Boolean))]
  const propertyMap = await lookupPropertyIds(uniqueAddresses)
  console.log(`  ${propertyMap.size} / ${uniqueAddresses.length} addresses matched to properties`)
  console.log("")

  let upserted = 0
  let skipped = 0
  let batch: SignalRow[] = []

  for (const v of violations) {
    const addr = v.address?.trim()
    if (!addr) { skipped++; continue }

    const propertyId = propertyMap.get(addr.toUpperCase())
    if (!propertyId) { skipped++; continue }

    const detail =
      v.outcome ??
      v.description ??
      `Priority: ${v.priority ?? "?"} | Dist: ${v.city_council_district ?? "?"}`
    const violationType = `${v.service_request_type} (${detail})`

    if (dryRun) {
      console.log({ property_id: propertyId, case_number: v.service_request_number, violationType, filed_at: v.created_date })
      upserted++
      continue
    }

    batch.push({
      property_id: propertyId,
      case_number: v.service_request_number,
      violation_type: violationType,
      filed_at: v.created_date,
      raw_data: JSON.stringify(v),
    })
    upserted++

    if (batch.length >= BATCH_SIZE) {
      await upsertBatch(batch)
      batch = []
    }
  }

  if (!dryRun && batch.length > 0) await upsertBatch(batch)

  console.log("--- Summary ---")
  console.log(`  Fetched:   ${violations.length}`)
  console.log(`  Upserted:  ${upserted}`)
  console.log(`  Skipped:   ${skipped}`)
}

main().catch(err => {
  console.error("Fatal:", err)
  process.exit(1)
})

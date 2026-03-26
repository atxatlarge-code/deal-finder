#!/usr/bin/env bun
/**
 * Daily signals refresh — fetches code violations from Dallas Open Data (Socrata)
 * Enriches the data with Deal Engine intent scoring.
 * Upserts into the Supabase signals table.
 *
 * Designed to be run on a schedule (cron, GitHub Actions, etc.).
 * Safe to re-run: ON CONFLICT (case_number) DO NOTHING skips duplicates.
 *
 * Usage:
 * bun scripts/refresh-signals.ts [--days N] [--dry-run]
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
// Interfaces
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

interface EnrichmentData {
  intent_score: number;
  flags: string[];
  is_high_priority: boolean;
}

interface SignalRow {
  property_id: string
  case_number: string
  violation_type: string
  filed_at: string
  raw_data: string
}

// ---------------------------------------------------------------------------
// Deal Engine Enrichment Engine
// ---------------------------------------------------------------------------

function enrichViolation(v: SocrataViolation): EnrichmentData {
  // BASE SCORE: Every valid city complaint gets at least 1 point 
  // so we can track chronic neglect over time.
  let score = 1;
  const flags: string[] = [];

  const typeUpper = (v.service_request_type || "").toUpperCase();
  const priorityUpper = (v.priority || "").toUpperCase();

  // 1. Priority Checks
  if (priorityUpper === "EMERGENCY") {
    score += 50;
    flags.push("EMERGENCY_ISSUE");
  }

  // 2. Absentee / Rental Checks
  if (typeUpper.includes("SINGLE FAMILY RENTAL")) {
    score += 40;
    flags.push("ABSENTEE_LANDLORD_FLAG");
  }

  // 3. Structural Distress Checks
  if (typeUpper.includes("SUBSTANDARD") || typeUpper.includes("VACANT") || typeUpper.includes("OPEN")) {
    score += 50;
    flags.push("SEVERE_STRUCTURAL_DISTRESS");
  }

  // 4. Deferred Maintenance Checks (Signs of giving up)
  if (typeUpper.includes("WEEDS") || typeUpper.includes("JUNK MOTOR") || typeUpper.includes("LITTER")) {
    score += 15;
    flags.push("DEFERRED_MAINTENANCE");
  }

  // 5. City Intervention (City having to mow or board up the house creates liens)
  if (typeUpper.includes("DECORATIVE BOARD UP") || typeUpper.includes("ABATEMENT")) {
    score += 60;
    flags.push("CITY_ABATEMENT_LIEN_RISK");
  }

  // 6. The General Catch-All
  if (flags.length === 0) {
    flags.push("GENERAL_NUISANCE");
  }

  return {
    intent_score: score,
    flags: flags,
    // Set your "hot lead" threshold here
    is_high_priority: score >= 40 
  };
}

// ---------------------------------------------------------------------------
// Socrata fetch
// ---------------------------------------------------------------------------

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
// Property lookup (Prefix-match strategy)
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

async function upsertBatch(batch: SignalRow[]): Promise<void> {
  // 1. First, insert the raw signals
  const signalRows = batch
    .map(s =>
      `(gen_random_uuid(),${esc(s.property_id)},'CODE_VIOLATION','Dallas 311',${esc(s.case_number)},${esc(s.filed_at)},'${s.raw_data.replace(/'/g, "''")}'::jsonb,now())`
    )
    .join(",")

  await sql.unsafe(`
    INSERT INTO signals (id, property_id, signal_type, source, case_number, filed_at, raw_data, created_at)
    VALUES ${signalRows}
    ON CONFLICT (case_number) WHERE case_number IS NOT NULL DO NOTHING
  `)

  // 2. Second, insert the LEAD SCORES so they show up in the UI
  // We extract the score from the JSON we just created
  const scoreRows = batch
    .map(s => {
      const data = JSON.parse(s.raw_data);
      const score = data.deal_engine.intent_score;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      
      return `(${esc(s.property_id)}, ${score}, 1, now(), '${expiresAt}')`
    })
    .join(",")

  await sql.unsafe(`
    INSERT INTO lead_scores (property_id, score, signal_count, scored_at, expires_at)
    VALUES ${scoreRows}
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

    // --- RUN ENRICHMENT ---
    const enrichment = enrichViolation(v);

    // Create a new payload that combines the raw Socrata data with Deal Engine logic
    const enrichedPayload = {
      ...v,
      deal_engine: {
        ...enrichment,
        processed_at: new Date().toISOString()
      }
    };

    const detail =
      v.outcome ??
      v.description ??
      `Priority: ${v.priority ?? "?"} | Dist: ${v.city_council_district ?? "?"}`
    
    // Optional: Append the score to the violation_type string so it's instantly visible in your DB
    const violationType = `[Score: ${enrichment.intent_score}] ${v.service_request_type} (${detail})`

    if (dryRun) {
      console.log(`[Score: ${enrichment.intent_score}] ${addr} | Flags: ${enrichment.flags.join(", ")}`);
      upserted++
      continue
    }

    batch.push({
      property_id: propertyId,
      case_number: v.service_request_number,
      violation_type: violationType,
      filed_at: v.created_date,
      // Save the enriched JSON, not just the raw Socrata JSON
      raw_data: JSON.stringify(enrichedPayload),
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
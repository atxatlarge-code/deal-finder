#!/usr/bin/env bun
/**
 * Daily signals refresh — Dallas Socrata 2026
 * Final Production Version: Handles Emergency Highlighting & Detail Columns
 */

import { sql } from "bun"

const DALLAS_APP_TOKEN = process.env.DALLAS_APP_TOKEN
const SOCRATA_DOMAIN = "www.dallasopendata.com"
const DATASET_ID = "gc4d-8a49"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const daysArg = args[args.indexOf("--days") + 1]
const lookbackDays = daysArg ? parseInt(daysArg, 10) : 14

interface SocrataViolation {
  service_request_number: string
  address: string
  service_request_type: string
  priority?: string
  created_date: string
  update_date: string
  [key: string]: unknown
}

interface SignalRow {
  property_id: string
  case_number: string
  signal_type: string
  violation_type: string 
  filed_at: string
  raw_data: string
}

function enrichViolation(v: SocrataViolation) {
  let score = 1;
  let isEmergency = false;
  const typeUpper = (v.service_request_type || "").toUpperCase();
  const caseId = v.service_request_number;

  // 2026 Emergency Rule: Case 26-00122702 OR Substandard Structure
  if (caseId === '26-00122702' || typeUpper.includes("SUBSTANDARD") || (v.priority || "").toUpperCase() === "EMERGENCY") {
    score += 100;
    isEmergency = true;
  }
  return { score, isEmergency };
}

async function fetchViolations(): Promise<SocrataViolation[]> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19)
  const params = new URLSearchParams({
    $where: `update_date > '${since}' AND department = 'Code Compliance'`,
    $limit: "5000",
    $order: "update_date DESC",
  })
  const url = `https://${SOCRATA_DOMAIN}/resource/${DATASET_ID}.json?${params}`
  const res = await fetch(url, { headers: DALLAS_APP_TOKEN ? { "X-App-Token": DALLAS_APP_TOKEN } : {} })
  return res.json()
}

function esc(s: string | null): string {
  return s === null ? "NULL" : `'${s.replace(/'/g, "''")}'`
}

async function lookupPropertyIds(addresses: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const addr of addresses) {
    const baseMatch = addr.toUpperCase().match(/^(\d+\s+[A-Z0-9]+)/);
    if (!baseMatch) continue;
    const rows = await sql.unsafe<{id: string}[]>(`SELECT id FROM properties WHERE UPPER(property_address) LIKE ${esc(baseMatch[1] + '%')} LIMIT 1`);
    if (rows.length > 0) map.set(addr.toUpperCase(), rows[0].id);
  }
  return map
}

async function upsertBatch(batch: SignalRow[]): Promise<void> {
  const signalRows = batch.map(s =>
    `(gen_random_uuid(), ${esc(s.property_id)}, ${esc(s.signal_type)}, 'Dallas 311', ${esc(s.case_number)}, ${esc(s.filed_at)}, ${esc(s.violation_type)}, '${s.raw_data.replace(/'/g, "''")}'::jsonb, now())`
  ).join(",")

  // 1. Update Signals table with the detail
  await sql.unsafe(`
    INSERT INTO signals (id, property_id, signal_type, source, case_number, filed_at, violation_type, raw_data, created_at)
    VALUES ${signalRows}
    ON CONFLICT (case_number) WHERE case_number IS NOT NULL 
    DO UPDATE SET signal_type = EXCLUDED.signal_type, violation_type = EXCLUDED.violation_type, raw_data = EXCLUDED.raw_data
  `)

  // 2. Aggregate the points onto the Property record
  for (const s of batch) {
    const data = JSON.parse(s.raw_data);
    await sql.unsafe(`
      UPDATE properties 
      SET 
        is_emergency = ${data.deal_engine.is_emergency}, 
        score = COALESCE(score, 0) + ${data.deal_engine.intent_score}, 
        last_signal_at = now()
      WHERE id = ${esc(s.property_id)}
    `);
  }
}

async function main() {
  const violations = await fetchViolations()
  const propertyMap = await lookupPropertyIds([...new Set(violations.map(v => v.address?.trim()).filter(Boolean))])

  let batch: SignalRow[] = []
  let matchCount = 0;

  for (const v of violations) {
    const addr = v.address?.trim() || ""
    const propertyId = propertyMap.get(addr.toUpperCase())

    if (!propertyId) continue
    matchCount++;

    const { score, isEmergency } = enrichViolation(v);
    const enrichedPayload = { ...v, deal_engine: { intent_score: score, is_emergency: isEmergency, processed_at: new Date().toISOString() } };

    batch.push({
      property_id: propertyId,
      case_number: v.service_request_number,
      signal_type: isEmergency ? 'EMERGENCY' : 'CODE_VIOLATION',
      violation_type: `[Score: ${score}] ${v.service_request_type}`,
      filed_at: v.created_date,
      raw_data: JSON.stringify(enrichedPayload),
    })

    if (batch.length >= 200) { await upsertBatch(batch); batch = []; }
  }
  if (!dryRun && batch.length > 0) await upsertBatch(batch)
  console.log(`🏁 Done. Processed ${violations.length} violations. Found ${matchCount} matches in your database.`);
}

main().catch(console.error)
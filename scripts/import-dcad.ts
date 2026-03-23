#!/usr/bin/env bun
/**
 * DCAD Account Import Script
 * Normalizes and upserts RES rows from the Dallas Central Appraisal District CSV
 * into the `properties` table via direct Postgres connection (bun:sql).
 *
 * Usage:
 *   bun scripts/import-dcad.ts --file /path/to/dcad_account.CSV [--dry-run] [--limit N]
 */

import { sql } from "bun";
import { createReadStream } from "fs";
import { parse } from "csv-parse";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const filePath = getArg("--file");
const dryRun = args.includes("--dry-run");
const limitArg = getArg("--limit");
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

if (!filePath) {
  console.error("Usage: bun scripts/import-dcad.ts --file <path> [--dry-run] [--limit N]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OwnershipType = "INDIVIDUAL" | "LLC" | "TRUST" | "ESTATE";

interface PropertyRow {
  parcel_id: string;
  property_address: string;
  mailing_address: string;
  owner_name: string;
  ownership_type: OwnershipType;
  assessed_value: null;
  equity: null;
}

// ---------------------------------------------------------------------------
// Field helpers
// ---------------------------------------------------------------------------

function buildPropertyAddress(row: Record<string, string>): string {
  const parts: string[] = [];

  const streetNum = row["STREET_NUM"]?.trim();
  if (streetNum) parts.push(streetNum);

  const halfNum = row["STREET_HALF_NUM"]?.trim();
  if (halfNum) parts.push(halfNum);

  const streetName = row["FULL_STREET_NAME"]?.trim();
  if (streetName) parts.push(streetName);

  const unit = row["UNIT_ID"]?.trim();
  if (unit) parts.push(`APT ${unit}`);

  return parts.join(" ");
}

function buildMailingAddress(row: Record<string, string>): string {
  const lines: string[] = [];

  for (const key of ["OWNER_ADDRESS_LINE1", "OWNER_ADDRESS_LINE2", "OWNER_ADDRESS_LINE3", "OWNER_ADDRESS_LINE4"]) {
    const val = row[key]?.trim();
    if (val) lines.push(val);
  }

  const city = row["OWNER_CITY"]?.trim();
  const state = row["OWNER_STATE"]?.trim();
  const zip = row["OWNER_ZIPCODE"]?.trim();

  const cityLine = [city, state].filter(Boolean).join(", ");
  const lastLine = zip ? `${cityLine} ${zip}` : cityLine;
  if (lastLine.trim()) lines.push(lastLine.trim());

  return lines.join("\n");
}

function buildOwnerName(row: Record<string, string>): string {
  const name1 = row["OWNER_NAME1"]?.trim() ?? "";
  const name2 = row["OWNER_NAME2"]?.trim() ?? "";
  return name2 ? `${name1} ${name2}`.trim() : name1;
}

function detectOwnershipType(ownerName1: string): OwnershipType {
  const name = ownerName1.toUpperCase();

  if (/LIFE ESTATE|ESTATE|EST OF/.test(name)) return "ESTATE";
  if (/TRUST/.test(name)) return "TRUST";
  if (/LLC|INC|CORP|LTD/.test(name)) return "LLC";
  return "INDIVIDUAL";
}

function normalizeRow(row: Record<string, string>): PropertyRow {
  return {
    parcel_id: row["ACCOUNT_NUM"].trim(),
    property_address: buildPropertyAddress(row),
    mailing_address: buildMailingAddress(row),
    owner_name: buildOwnerName(row),
    ownership_type: detectOwnershipType(row["OWNER_NAME1"] ?? ""),
    assessed_value: null,
    equity: null,
  };
}

// ---------------------------------------------------------------------------
// DB upsert
// ---------------------------------------------------------------------------

// Escape a string value for use in sql.unsafe() — doubles single quotes.
function esc(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

async function upsertBatch(batch: PropertyRow[]): Promise<void> {
  // One round-trip for the entire batch via multi-row VALUES.
  // sql.unsafe() is safe here — all values are from a trusted CSV and single-quoted.
  const rows = batch
    .map(p =>
      `(${esc(p.parcel_id)},${esc(p.property_address)},${esc(p.mailing_address)},${esc(p.owner_name)},${esc(p.ownership_type)},NULL,NULL,now())`
    )
    .join(",");

  await sql.unsafe(`
    INSERT INTO properties (parcel_id,property_address,mailing_address,owner_name,ownership_type,assessed_value,equity,updated_at)
    VALUES ${rows}
    ON CONFLICT (parcel_id) DO UPDATE SET
      property_address = EXCLUDED.property_address,
      mailing_address  = EXCLUDED.mailing_address,
      owner_name       = EXCLUDED.owner_name,
      ownership_type   = EXCLUDED.ownership_type,
      updated_at       = now()
  `);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;
const LOG_EVERY = 10_000;

async function main(): Promise<void> {
  console.log(`DCAD import — file: ${filePath}`);
  if (dryRun) console.log("DRY RUN — no DB writes");
  if (limit !== Infinity) console.log(`Limit: ${limit} RES rows`);
  console.log("");

  let totalRead = 0;
  let skipped = 0;
  let upserted = 0;
  let errors = 0;
  let batch: PropertyRow[] = [];

  const parser = createReadStream(filePath!).pipe(
    parse({ columns: true, trim: true, skip_empty_lines: true })
  );

  for await (const row of parser) {
    totalRead++;

    // Skip non-RES and excluded owners
    if (row["DIVISION_CD"] !== "RES" || row["EXCLUDE_OWNER"] === "Y") {
      skipped++;
      continue;
    }

    let normalized: PropertyRow;
    try {
      normalized = normalizeRow(row);
    } catch (err) {
      errors++;
      console.error(`Row ${totalRead} normalize error:`, err);
      continue;
    }

    if (dryRun) {
      console.log(JSON.stringify(normalized, null, 2));
    } else {
      batch.push(normalized);
    }

    upserted++;

    if (upserted % LOG_EVERY === 0) {
      console.log(`  Progress: ${upserted.toLocaleString()} upserted, ${skipped.toLocaleString()} skipped (${totalRead.toLocaleString()} read)`);
    }

    // Flush batch
    if (!dryRun && batch.length >= BATCH_SIZE) {
      try {
        await upsertBatch(batch);
      } catch (err) {
        errors += batch.length;
        console.error("Batch upsert error:", err);
      }
      batch = [];
    }

    if (upserted >= limit) break;
  }

  // Flush remaining
  if (!dryRun && batch.length > 0) {
    try {
      await upsertBatch(batch);
    } catch (err) {
      errors += batch.length;
      console.error("Final batch upsert error:", err);
    }
  }

  console.log("");
  console.log("--- Summary ---");
  console.log(`  Total rows read:  ${totalRead.toLocaleString()}`);
  console.log(`  Skipped:          ${skipped.toLocaleString()}`);
  console.log(`  Upserted:         ${upserted.toLocaleString()}`);
  console.log(`  Errors:           ${errors.toLocaleString()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

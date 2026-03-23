#!/usr/bin/env bun
/**
 * DCAD Values Import Script
 * Updates assessed_value on existing properties rows from ACCOUNT_APPRL_YEAR.CSV.
 *
 * Usage:
 *   bun scripts/import-dcad-values.ts --file /path/to/ACCOUNT_APPRL_YEAR.CSV [--dry-run] [--limit N]
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
  console.error("Usage: bun scripts/import-dcad-values.ts --file <path> [--dry-run] [--limit N]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Batch update
// ---------------------------------------------------------------------------

function esc(s: string | null): string {
  if (s === null) return "NULL";
  return `'${s.replace(/'/g, "''")}'`;
}

async function updateBatch(batch: Array<{ parcel_id: string; assessed_value: number }>): Promise<void> {
  // Single query using a VALUES list joined back to properties.
  const rows = batch
    .map(r => `(${esc(r.parcel_id)},${r.assessed_value})`)
    .join(",");

  await sql.unsafe(`
    UPDATE properties
    SET assessed_value = v.assessed_value,
        updated_at     = now()
    FROM (VALUES ${rows}) AS v(parcel_id, assessed_value)
    WHERE properties.parcel_id = v.parcel_id
  `);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;
const LOG_EVERY = 10_000;

async function main(): Promise<void> {
  console.log(`DCAD values import — file: ${filePath}`);
  if (dryRun) console.log("DRY RUN — no DB writes");
  if (limit !== Infinity) console.log(`Limit: ${limit} RES rows`);
  console.log("");

  let totalRead = 0;
  let skipped = 0;
  let updated = 0;
  let errors = 0;
  let batch: Array<{ parcel_id: string; assessed_value: number }> = [];

  const parser = createReadStream(filePath!).pipe(
    parse({ columns: true, trim: true, skip_empty_lines: true })
  );

  for await (const row of parser) {
    totalRead++;

    if (row["DIVISION_CD"] !== "RES") {
      skipped++;
      continue;
    }

    const rawVal = row["TOT_VAL"]?.trim();
    const assessed_value = rawVal ? parseFloat(rawVal) : null;

    if (assessed_value === null || isNaN(assessed_value)) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log({ parcel_id: row["ACCOUNT_NUM"].trim(), assessed_value });
    } else {
      batch.push({ parcel_id: row["ACCOUNT_NUM"].trim(), assessed_value });
    }

    updated++;

    if (updated % LOG_EVERY === 0) {
      console.log(`  Progress: ${updated.toLocaleString()} updated, ${skipped.toLocaleString()} skipped (${totalRead.toLocaleString()} read)`);
    }

    if (!dryRun && batch.length >= BATCH_SIZE) {
      try {
        await updateBatch(batch);
      } catch (err) {
        errors += batch.length;
        console.error("Batch update error:", err);
      }
      batch = [];
    }

    if (updated >= limit) break;
  }

  if (!dryRun && batch.length > 0) {
    try {
      await updateBatch(batch);
    } catch (err) {
      errors += batch.length;
      console.error("Final batch update error:", err);
    }
  }

  console.log("");
  console.log("--- Summary ---");
  console.log(`  Total rows read:  ${totalRead.toLocaleString()}`);
  console.log(`  Skipped:          ${skipped.toLocaleString()}`);
  console.log(`  Updated:          ${updated.toLocaleString()}`);
  console.log(`  Errors:           ${errors.toLocaleString()}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

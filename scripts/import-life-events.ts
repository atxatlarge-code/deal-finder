import { sql } from "bun";
import { parse } from "csv-parse/sync";
import fs from "fs";

// Usage: bun scripts/import-life-events.ts --file ./data/leads.csv --type DIVORCE
const args = Bun.argv.slice(2);
const filePath = args[args.indexOf("--file") + 1];
const signalType = args[args.indexOf("--type") + 1];

async function importLifeEvents() {
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const records = parse(fileContent, { columns: true, skip_empty_lines: true });

  console.log(`🚀 Processing ${records.length} ${signalType} records...`);

  for (const record of records) {
    const rawAddress = record.property_address.toUpperCase().trim();
    
    // Fuzzy match on first 15 chars to catch "St" vs "Street"
    const property = await sql`
      SELECT id FROM properties 
      WHERE property_address ILIKE ${rawAddress.substring(0, 15) + '%'}
      LIMIT 1
    `;

    if (property.length > 0) {
      const propertyId = property[0].id;
      const filedAt = record.filed_at || new Date().toISOString();

      await sql`
        INSERT INTO signals (
          property_id, 
          signal_type, 
          case_number, 
          description, 
          source_url,
          filed_at
        ) VALUES (
          ${propertyId}, 
          ${signalType}, 
          ${record.case_number}, 
          ${record.description || `Dallas County ${signalType} Filing`}, 
          ${record.source_url || null},
          ${filedAt}
        ) ON CONFLICT (case_number) DO UPDATE SET
          source_url = EXCLUDED.source_url,
          filed_at = EXCLUDED.filed_at;
      `;
      console.log(`✅ Linked: ${rawAddress}`);
    } else {
      console.log(`⚠️  No property match for: ${rawAddress}`);
    }
  }

  console.log("✨ Done.");
  process.exit(0);
}

importLifeEvents();
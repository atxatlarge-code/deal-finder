import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function enrichHighPressureLeads() {
  console.log("🚀 Starting Dallas Active Case Sync...");

  // 1. Updated Select: Fetch property_address since street_number doesn't exist
  const { data: leads, error: fetchError } = await supabase
    .from('properties')
    .select('id, property_address, score, ownership_type')
    .or('score.gt.70,ownership_type.eq.ESTATE');

  if (fetchError || !leads) {
    console.error("❌ Error fetching leads:", fetchError);
    return;
  }

  console.log(`🔎 Checking ${leads.length} leads for active cases...`);
  let totalViolationsSynced = 0;

  for (const lead of leads) {
    // 🎯 HELPER: Split "8441 GREENSTONE DR" into "8441" and "GREENSTONE"
    const match = lead.property_address?.match(/^(\d+)\s+(.*)$/);
    if (!match) {
      console.log(`⚠️ Skipping malformed address: ${lead.property_address}`);
      continue;
    }

    const streetNum = match[1];
    // We take the first word of the street name (e.g., "GREENSTONE") for better API matching
    const streetName = match[2].toUpperCase().split(' ')[0]; 

    const dallasUrl = `https://www.dallasopendata.com/resource/7889-igwf.json?street_num=${streetNum}&street_name=${streetName}`;
    
    try {
      const response = await fetch(dallasUrl, {
        headers: { 'X-App-Token': process.env.DALLAS_OPENDATA_TOKEN || '' }
      });
      const activeCases = await response.json();

      if (Array.isArray(activeCases) && activeCases.length > 0) {
        console.log(`\n🔥 ${activeCases.length} CASES FOUND: ${lead.property_address}`);

        for (const caseData of activeCases) {
          // Unique ID logic to prevent the "Greenstone Overwrite"
          const violationSlug = (caseData.violation || 'UNKNOWN').replace(/\s+/g, '_');
          const uniqueCaseId = `${caseData.case_no}-${violationSlug}`;

          const { error: upsertError } = await supabase.from('signals').upsert({
            property_id: lead.id,
            signal_type: 'CODE_VIOLATION',
            case_number: uniqueCaseId, 
            description: `OFFICIAL VIOLATION: ${caseData.violation}`,
            status: caseData.case_status?.toUpperCase() || 'OPEN',
            filed_at: caseData.case_date,
            raw_data: { ...caseData, source: 'DALLAS_ACTIVE_CASES' }
          }, { onConflict: 'case_number' });

          if (!upsertError) {
            totalViolationsSynced++;
            process.stdout.write("✅"); 
          }
        }
      } else {
        process.stdout.write("."); 
      }
    } catch (e) {
      console.error(`\n❌ API Error for ${lead.property_address}:`, e);
    }
  }

  console.log(`\n\n🏁 Sync Finished. Total Unique Violations Tracked: ${totalViolationsSynced}`);
}

enrichHighPressureLeads();
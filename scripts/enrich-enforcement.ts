import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Setup Environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function runFullHistorySync() {
  console.log("🚀 Starting Dallas Enforcement Sync (Full History Mode)...");

  // 2. Fetch properties (Focusing on High Score or Estates)
  const { data: properties, error } = await supabase
    .from('properties')
    .select('id, property_address, score')
    .or('score.gt.50,ownership_type.eq.ESTATE')
    .order('score', { ascending: false })
    .limit(100); 

  if (error || !properties) {
    console.error("❌ Supabase Fetch Error:", error);
    return;
  }

  console.log(`🔎 Scanning ${properties.length} properties for historical distress...`);
  let totalCasesFound = 0;

  for (const prop of properties) {
    // Split address (e.g., "8441 GREENSTONE DR") into Number and Street Name
    const match = prop.property_address?.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;

    const num = match[1];
    // Take the first word of the street (e.g., "GREENSTONE") for wider API matching
    const street = match[2].toUpperCase().split(' ')[0]; 

    // Query Dallas Open Data (Historical Enforcement Dataset x9pz-kdq9)
    const url = `https://www.dallasopendata.com/resource/x9pz-kdq9.json?str_num=${num}&str_nam=${street}&$order=created DESC`;

    try {
      const res = await fetch(url, {
        headers: { 'X-App-Token': process.env.DALLAS_OPENDATA_TOKEN || '' }
      });
      const cases = await res.json();

      if (Array.isArray(cases) && cases.length > 0) {
        console.log(`\n📚 HISTORY: ${cases.length} violations for ${prop.property_address}`);
        const newestDate = cases[0].created;

        for (const c of cases) {
          totalCasesFound++;
          
          // 🎯 UNIQUE ID LOGIC: Case ID + Violation Type slug
          // Ensures 19 separate rows are created in your signals table
          const violationSlug = (c.nuisance || c.type || 'UNKNOWN').replace(/\s+/g, '_');
          const uniqueCaseId = c.service_request 
            ? `${c.service_request}-${violationSlug}` 
            : `HIST-${prop.id}-${c.created}`;

          // 3. Insert into SIGNALS (Evidence Log)
          const { error: upsertError } = await supabase.from('signals').upsert({
            property_id: prop.id,
            signal_type: 'CODE_VIOLATION',
            source: 'Dallas Open Data: Enforcement',
            case_number: uniqueCaseId,
            description: `${c.type}: ${c.nuisance}`,
            filed_at: c.created,
            status: c.status?.toUpperCase() || 'CLOSED', 
            violation_type: c.type,
            raw_data: { ...c, source_dataset: 'x9pz-kdq9' }
          }, { onConflict: 'case_number' });

          if (upsertError) {
            console.error(`\n❌ DB Error for ${uniqueCaseId}:`, upsertError.message);
          } else {
            process.stdout.write("✅"); 
          }
        }

        // 4. Update PROPERTY (Metadata & Recency)
        await supabase
          .from('properties')
          .update({ 
            last_signal_at: newestDate,
            is_emergency: cases.some(c => c.status?.toUpperCase() === 'OPEN')
          })
          .eq('id', prop.id);

      } else {
        process.stdout.write("."); 
      }
    } catch (e) {
      console.error(`\n❌ API Error for ${prop.property_address}:`, e);
    }
  }

  console.log(`\n\n🏁 Sync Finished. Total Violations Tracked: ${totalCasesFound}`);
  
  // 5. Run the Scoring Engine
  await calculateDistressScores();
}

async function calculateDistressScores() {
  console.log("📊 Updating Property Scores based on Signal History...");

  const { data: signalCounts, error } = await supabase
    .from('signals')
    .select('property_id, status')
    .eq('signal_type', 'CODE_VIOLATION');

  if (error || !signalCounts) return;

  const scoresMap = new Map<string, number>();

  // Open violations = 50pts, Closed/Historical = 10pts
  signalCounts.forEach(sig => {
    const currentScore = scoresMap.get(sig.property_id) || 0;
    const points = sig.status === 'OPEN' ? 50 : 10;
    scoresMap.set(sig.property_id, currentScore + points);
  });

  for (const [id, additionalScore] of scoresMap.entries()) {
    // Attempting to increment property score
    const { error: updateError } = await supabase
      .from('properties')
      .update({ score: additionalScore }) // You can also use an RPC here if defined
      .eq('id', id);

    if (updateError) {
      console.error(`❌ Score Update Error for ${id}:`, updateError.message);
    }
  }

  console.log("✅ All Property Scores recalculated.");
}

runFullHistorySync();
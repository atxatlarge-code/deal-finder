import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { computeScore, SCORE_VERSION } from '@/lib/scoring'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = adminClient()
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Fetch all active signals
  const { data: signals, error: sigErr } = await supabase
    .from('signals')
    .select('property_id, signal_type')
    .gt('filed_at', cutoff)

  if (sigErr) {
    return NextResponse.json({ error: sigErr.message }, { status: 500 })
  }

  // Group signals by property
  const byProperty = new Map<string, Array<{ signal_type: string }>>()
  for (const s of signals ?? []) {
    if (!byProperty.has(s.property_id)) byProperty.set(s.property_id, [])
    byProperty.get(s.property_id)!.push({ signal_type: s.signal_type })
  }

  if (byProperty.size === 0) {
    return NextResponse.json({ status: 'ok', scored: 0, message: 'No active signals found.' })
  }

  // 2. Fetch property details (ownership_type, is_absentee)
  const propertyIds = [...byProperty.keys()]
  const { data: properties, error: propErr } = await supabase
    .from('properties')
    .select('id, ownership_type, is_absentee')
    .in('id', propertyIds)

  if (propErr) {
    return NextResponse.json({ error: propErr.message }, { status: 500 })
  }

  // 3. Compute scores
  const rows = (properties ?? []).map((p) => {
    const { score, signal_count } = computeScore({
      signals: byProperty.get(p.id) ?? [],
      is_absentee: p.is_absentee,
      ownership_type: p.ownership_type,
    })
    return {
      property_id: p.id,
      score,
      signal_count,
      score_version: SCORE_VERSION,
    }
  })

  // 4. Insert (versioned — always insert, never update)
  // Batch in chunks of 500
  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('lead_scores').insert(rows.slice(i, i + 500))
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    inserted += rows.slice(i, i + 500).length
  }

  return NextResponse.json({
    status: 'ok',
    scored: inserted,
    score_version: SCORE_VERSION,
    scored_at: new Date().toISOString(),
  })
}

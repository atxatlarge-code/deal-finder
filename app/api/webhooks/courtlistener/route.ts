import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { fetchDebtorParties, parseDebtorAddress, type Docket } from '@/lib/courtlistener'
import { computeScore, SCORE_VERSION } from '@/lib/scoring'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Match a street address string to a property_id in Supabase.
 * Exact UPPER() match first; prefix 10-char fallback.
 */
async function matchProperty(
  supabase: ReturnType<typeof adminClient>,
  address: string,
): Promise<string | null> {
  const upper = address.toUpperCase()

  // Exact match
  const { data: exact } = await supabase
    .from('properties')
    .select('id')
    .eq('property_address', upper)
    .limit(1)
    .single()

  if (exact) return exact.id

  // Prefix fallback (first 10 chars)
  const prefix = upper.slice(0, 10)
  const { data: rows } = await supabase
    .from('properties')
    .select('id, property_address')
    .ilike('property_address', `${prefix}%`)
    .limit(1)

  return rows?.[0]?.id ?? null
}

/**
 * Re-score a set of property IDs immediately after new signals are upserted.
 */
async function rescoreProperties(
  supabase: ReturnType<typeof adminClient>,
  propertyIds: string[],
): Promise<void> {
  if (propertyIds.length === 0) return

  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()

  const { data: signals } = await supabase
    .from('signals')
    .select('property_id, signal_type')
    .in('property_id', propertyIds)
    .gt('filed_at', cutoff)

  const { data: properties } = await supabase
    .from('properties')
    .select('id, ownership_type, is_absentee')
    .in('id', propertyIds)

  if (!signals || !properties) return

  const byProperty = new Map<string, Array<{ signal_type: string }>>()
  for (const s of signals) {
    if (!byProperty.has(s.property_id)) byProperty.set(s.property_id, [])
    byProperty.get(s.property_id)!.push({ signal_type: s.signal_type })
  }

  const rows = properties.map((p) => {
    const { score, signal_count } = computeScore({
      signals: byProperty.get(p.id) ?? [],
      is_absentee: p.is_absentee,
      ownership_type: p.ownership_type,
    })
    return { property_id: p.id, score, signal_count, score_version: SCORE_VERSION }
  })

  if (rows.length > 0) {
    await supabase.from('lead_scores').insert(rows)
  }
}

export async function POST(request: NextRequest) {
  // 1. Verify secret query param
  const { searchParams } = new URL(request.url)
  const webhookSecret = process.env.COURTLISTENER_WEBHOOK_SECRET
  if (!webhookSecret || searchParams.get('secret') !== webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Parse body
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 3. Only handle search.alert.recap events
  if (body.event_type !== 'search.alert.recap') {
    return NextResponse.json({ ok: true, matched: 0, skipped: 0, reason: 'event_type ignored' })
  }

  const results = (body.results as Docket[]) ?? []
  if (results.length === 0) {
    return NextResponse.json({ ok: true, matched: 0, skipped: 0 })
  }

  const supabase = adminClient()
  let matched = 0
  let skipped = 0
  const matchedPropertyIds: string[] = []

  // 4. Process each docket
  for (const docket of results) {
    let parties
    try {
      parties = await fetchDebtorParties(docket.id)
    } catch (err) {
      console.error(`Failed to fetch parties for docket ${docket.id}:`, err)
      skipped++
      continue
    }

    for (const party of parties) {
      const address = parseDebtorAddress(party.extra_info)
      if (!address) {
        skipped++
        continue
      }

      const propertyId = await matchProperty(supabase, address)
      if (!propertyId) {
        skipped++
        continue
      }

      const chapter = docket.bankruptcy_information?.chapter
      const description = chapter
        ? `Chapter ${chapter} Bankruptcy`
        : 'Bankruptcy'

      const { error } = await supabase.from('signals').insert({
        property_id: propertyId,
        signal_type: 'BANKRUPTCY',
        source: 'CourtListener/RECAP',
        case_number: docket.docket_number,
        filed_at: docket.date_filed,
        description,
        source_url: `https://www.courtlistener.com${docket.absolute_url}`,
        raw_data: docket,
      })

      // ON CONFLICT (case_number) DO NOTHING — duplicate just means already inserted
      if (error && !error.message.includes('conflict') && !error.code?.startsWith('23')) {
        console.error('Signal insert error:', error)
        skipped++
        continue
      }

      matched++
      if (!matchedPropertyIds.includes(propertyId)) {
        matchedPropertyIds.push(propertyId)
      }
    }
  }

  // 5. Re-score matched properties immediately
  await rescoreProperties(supabase, matchedPropertyIds)

  return NextResponse.json({ ok: true, matched, skipped })
}

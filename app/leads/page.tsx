import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import FilterBar from './_components/FilterBar'
import HotLeads, { type HotLead } from './_components/HotLeads'
import { scoreBand } from '@/lib/scoring'
import type { OwnershipType } from '@/types'

const PAGE_SIZE = 50

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

type PropertyRow = {
  id: string
  property_address: string
  owner_name: string | null
  ownership_type: string | null
  assessed_value: number | null
  is_absentee: boolean | null
  score: number | null
  signal_count: number
}

async function fetchProperties(
  type: string | undefined,
  absentee: boolean,
  scored: boolean,
  page: number,
): Promise<{ data: PropertyRow[]; count: number }> {
  const supabase = adminClient()
  const offset = (page - 1) * PAGE_SIZE

  if (scored) {
    // Start from lead_scores (sorted by recency), dedupe, sort by score
    const { data: allScores } = await supabase
      .from('lead_scores')
      .select('property_id, score, signal_count')
      .gt('expires_at', new Date().toISOString())
      .order('scored_at', { ascending: false })

    // Latest score per property
    const latestScores = new Map<string, { score: number; signal_count: number }>()
    for (const s of allScores ?? []) {
      if (!latestScores.has(s.property_id)) {
        latestScores.set(s.property_id, { score: s.score, signal_count: s.signal_count })
      }
    }

    // Sort by score desc
    const sorted = [...latestScores.entries()].sort((a, b) => b[1].score - a[1].score)
    const total = sorted.length
    const pageIds = sorted.slice(offset, offset + PAGE_SIZE).map(([id]) => id)

    if (pageIds.length === 0) return { data: [], count: total }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let propQuery: any = supabase
      .from('properties')
      .select('id, property_address, owner_name, ownership_type, assessed_value, is_absentee')
      .in('id', pageIds)

    if (type && type !== 'ALL') propQuery = propQuery.eq('ownership_type', type as OwnershipType)
    if (absentee) propQuery = propQuery.eq('is_absentee', true)

    const { data: properties } = await propQuery
    const idOrder = new Map(pageIds.map((id, i) => [id, i]))

    const data: PropertyRow[] = (properties ?? [])
      .map((p: Omit<PropertyRow, 'score' | 'signal_count'>) => ({
        ...p,
        score: latestScores.get(p.id)?.score ?? null,
        signal_count: latestScores.get(p.id)?.signal_count ?? 0,
      }))
      .sort((a: PropertyRow, b: PropertyRow) =>
        (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999)
      )

    return { data, count: total }
  }

  // Default: all properties sorted by assessed_value
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase
    .from('properties')
    .select('id, property_address, owner_name, ownership_type, assessed_value, is_absentee', { count: 'exact' })
    .order('assessed_value', { ascending: false, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (type && type !== 'ALL') query = query.eq('ownership_type', type as OwnershipType)
  if (absentee) query = query.eq('is_absentee', true)

  const { data: properties, count } = await query

  // Fetch scores for this page
  const ids = (properties ?? []).map((p: { id: string }) => p.id)
  const scoreMap = new Map<string, { score: number; signal_count: number }>()
  if (ids.length > 0) {
    const { data: scores } = await supabase
      .from('lead_scores')
      .select('property_id, score, signal_count')
      .in('property_id', ids)
      .gt('expires_at', new Date().toISOString())
      .order('scored_at', { ascending: false })
    for (const s of scores ?? []) {
      if (!scoreMap.has(s.property_id)) {
        scoreMap.set(s.property_id, { score: s.score, signal_count: s.signal_count })
      }
    }
  }

  const data: PropertyRow[] = (properties ?? []).map((p: Omit<PropertyRow, 'score' | 'signal_count'>) => ({
    ...p,
    score: scoreMap.get(p.id)?.score ?? null,
    signal_count: scoreMap.get(p.id)?.signal_count ?? 0,
  }))

  return { data, count: count ?? 0 }
}

const getCachedProperties = unstable_cache(
  fetchProperties,
  ['properties-list'],
  { revalidate: 300, tags: ['properties-list'] },
)

async function fetchHotLeads(): Promise<HotLead[]> {
  const supabase = adminClient()

  // Get top scores (deduplicated to latest per property)
  const { data: allScores } = await supabase
    .from('lead_scores')
    .select('property_id, score, signal_count')
    .gt('expires_at', new Date().toISOString())
    .order('scored_at', { ascending: false })

  const latest = new Map<string, { score: number; signal_count: number }>()
  for (const s of allScores ?? []) {
    if (!latest.has(s.property_id)) latest.set(s.property_id, s)
  }

  const top = [...latest.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 10)

  if (top.length === 0) return []

  const ids = top.map(([id]) => id)

  const { data: properties } = await supabase
    .from('properties')
    .select('id, property_address, owner_name, ownership_type, assessed_value, is_absentee')
    .in('id', ids)

  const { data: signals } = await supabase
    .from('signals')
    .select('property_id, signal_type')
    .in('property_id', ids)
    .gt('filed_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())

  const signalsByProp = new Map<string, string[]>()
  for (const s of signals ?? []) {
    if (!signalsByProp.has(s.property_id)) signalsByProp.set(s.property_id, [])
    signalsByProp.get(s.property_id)!.push(s.signal_type)
  }

  const scoreOrder = new Map(top.map(([id], i) => [id, i]))

  return (properties ?? [])
    .map((p): HotLead => ({
      ...p,
      score: latest.get(p.id)!.score,
      signal_count: latest.get(p.id)!.signal_count,
      signal_types: [...new Set(signalsByProp.get(p.id) ?? [])],
    }))
    .sort((a, b) => (scoreOrder.get(a.id) ?? 9) - (scoreOrder.get(b.id) ?? 9))
}

const getCachedHotLeads = unstable_cache(
  fetchHotLeads,
  ['hot-leads'],
  { revalidate: 300 },
)

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  LLC:        { bg: 'var(--tag-code-bg)',    text: 'var(--tag-code-text)' },
  TRUST:      { bg: 'var(--tag-trust-bg)',   text: 'var(--tag-trust-text)' },
  ESTATE:     { bg: 'var(--tag-divorce-bg)', text: 'var(--tag-divorce-text)' },
  INDIVIDUAL: { bg: 'var(--bg-base)',        text: 'var(--text-muted)' },
}

const SCORE_STYLES = {
  high: { bg: 'var(--score-high-bg)', text: 'var(--score-high-text)' },
  med:  { bg: 'var(--score-med-bg)',  text: 'var(--score-med-text)' },
  low:  { bg: 'var(--score-low-bg)',  text: 'var(--score-low-text)' },
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
  const s = SCORE_STYLES[scoreBand(score)]
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '6px',
      fontSize: '0.75rem',
      fontWeight: 700,
      fontFamily: 'var(--font-data)',
      background: s.bg,
      color: s.text,
      minWidth: '32px',
      textAlign: 'center',
    }}>
      {score}
    </span>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return null
  const s = TYPE_STYLES[type] ?? TYPE_STYLES.INDIVIDUAL
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 7px',
      borderRadius: '9999px',
      fontSize: '0.7rem',
      fontWeight: 600,
      background: s.bg,
      color: s.text,
    }}>
      {type}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface SearchParams {
  type?: string
  absentee?: string
  scored?: string
  page?: string
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

    // filters and presets
  const params = await searchParams;
  const type = params.type;
  const page = params.page;
  const scored = params.scored ?? '1';
  const absentee = params.absentee ?? '1';

  const currentPage = Math.max(1, parseInt(page ?? '1', 10))

  const [{ data: properties, count }, hotLeads] = await Promise.all([
    getCachedProperties(type, absentee === '1', scored === '1', currentPage),
    getCachedHotLeads(),
  ])
  const total = count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const buildUrl = (p: number) => {
    const params = new URLSearchParams()
    if (type && type !== 'ALL') params.set('type', type)
    if (absentee === '1') params.set('absentee', '1')
    if (scored === '1') params.set('scored', '1')
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return `/leads${qs ? `?${qs}` : ''}`
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">

        <header className="mb-6">
          <h1
            className="text-2xl font-semibold"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}
          >
            Deal Finder
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '4px' }}>
            Dallas residential parcels
          </p>
        </header>

        <HotLeads leads={hotLeads} />

        <FilterBar
          activeType={type ?? 'ALL'}
          absentee={absentee === '1'}
          scored={scored === '1'}
          total={total}
        />

        <div
          className="rounded-lg border overflow-hidden"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
        >
          {properties.length === 0 ? (
            <div className="p-12 text-center" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
              No properties match these filters.
            </div>
          ) : (
            <table className="w-full" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
                  {['Score', 'Address', 'Owner', 'Type', 'Value', ''].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: '10px 16px',
                        textAlign: 'left',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr
                    key={p.id}
                    style={{ borderBottom: '1px solid var(--border)' }}
                    className="hover:bg-[var(--bg-base)] transition-colors"
                  >
                    <td style={{ padding: '12px 16px', width: '64px' }}>
                      <ScoreBadge score={p.score} />
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <Link
                        href={`/leads/${p.id}`}
                        style={{
                          fontWeight: 500,
                          color: 'var(--text-primary)',
                          textDecoration: 'none',
                          fontSize: '0.875rem',
                        }}
                      >
                        {p.property_address}
                      </Link>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {p.owner_name ?? '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <TypeBadge type={p.ownership_type} />
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'var(--font-data)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {p.assessed_value != null ? `$${p.assessed_value.toLocaleString()}` : '—'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {p.is_absentee && (
                        <span style={{
                          display: 'inline-block',
                          padding: '1px 7px',
                          borderRadius: '9999px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          background: 'var(--tag-absentee-bg)',
                          color: 'var(--tag-absentee-text)',
                        }}>
                          absentee
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-5">
            <Link
              href={buildUrl(currentPage - 1)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                fontSize: '0.8rem',
                color: currentPage <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
                pointerEvents: currentPage <= 1 ? 'none' : 'auto',
                background: 'var(--bg-surface)',
                textDecoration: 'none',
              }}
            >
              ← Previous
            </Link>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
              {currentPage.toLocaleString()} / {totalPages.toLocaleString()}
            </span>
            <Link
              href={buildUrl(currentPage + 1)}
              style={{
                padding: '6px 14px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                fontSize: '0.8rem',
                color: currentPage >= totalPages ? 'var(--text-muted)' : 'var(--text-secondary)',
                pointerEvents: currentPage >= totalPages ? 'none' : 'auto',
                background: 'var(--bg-surface)',
                textDecoration: 'none',
              }}
            >
              Next →
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}

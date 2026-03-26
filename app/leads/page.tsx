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

/**
 * REFACTORED: Uses SQL Joins to handle high-volume scoring without 
 * memory bottlenecks or "hidden" 55-point leads.
 */
async function fetchProperties(
  type: string | undefined,
  absentee: boolean,
  scored: boolean,
  page: number,
): Promise<{ data: PropertyRow[]; count: number }> {
  const supabase = adminClient()
  const offset = (page - 1) * PAGE_SIZE

  // Base query selecting from lead_scores to ensure we only get "Active" leads
  let query = supabase
    .from('lead_scores')
    .select(`
      score,
      signal_count,
      property:properties!inner (
        id,
        property_address,
        owner_name,
        ownership_type,
        assessed_value,
        is_absentee
      )
    `, { count: 'exact' })
    .gt('expires_at', new Date().toISOString())
    .order('score', { ascending: false })
    .order('scored_at', { ascending: false }) // Tie-breaker for the 55s
    .range(offset, offset + PAGE_SIZE - 1)

  // Apply Filters
  if (type && type !== 'ALL') query = query.eq('properties.ownership_type', type)
  if (absentee) query = query.eq('properties.is_absentee', true)

  const { data, count, error } = await query

  if (error) {
    console.error('Fetch Error:', error)
    return { data: [], count: 0 }
  }

  // Flatten the nested join structure for the UI
  const flattened: PropertyRow[] = (data ?? []).map((row: any) => ({
    ...row.property,
    score: row.score,
    signal_count: row.signal_count
  }))

  return { data: flattened, count: count ?? 0 }
}

const getCachedProperties = unstable_cache(
  fetchProperties,
  ['properties-list'],
  { revalidate: 300, tags: ['properties-list'] },
)

/**
 * Fetches the top 10 leads for the "Bubbles" section.
 */
async function fetchHotLeads(): Promise<HotLead[]> {
  const supabase = adminClient()

  const { data: scores } = await supabase
    .from('lead_scores')
    .select(`
      score,
      signal_count,
      property:properties!inner (
        id,
        property_address,
        owner_name,
        ownership_type,
        assessed_value,
        is_absentee
      )
    `)
    .gt('expires_at', new Date().toISOString())
    .order('score', { ascending: false })
    .limit(10)

  if (!scores) return []

  const ids = scores.map(s => s.property.id)

  // Fetch recent signal types for the badges
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

  return scores.map((s: any): HotLead => ({
    ...s.property,
    score: s.score,
    signal_count: s.signal_count,
    signal_types: [...new Set(signalsByProp.get(s.property.id) ?? [])],
  }))
}

const getCachedHotLeads = unstable_cache(
  fetchHotLeads,
  ['hot-leads'],
  { revalidate: 300 },
)

// --- Styling & Badges ---

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  LLC:        { bg: 'var(--tag-code-bg)',    text: 'var(--tag-code-text)' },
  TRUST:      { bg: 'var(--tag-trust-bg)',   text: 'var(--tag-trust-text)' },
  ESTATE:     { bg: '#f3e8ff',               text: '#7e22ce' }, // Standardized Purple
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

function TypeBadge({ type, owner }: { type: string | null; owner: string | null }) {
  const isEstate = type === 'ESTATE' || owner?.includes('EST OF')
  const s = isEstate ? TYPE_STYLES.ESTATE : (TYPE_STYLES[type || ''] ?? TYPE_STYLES.INDIVIDUAL)
  
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
      {isEstate ? 'ESTATE' : (type ?? 'INDIVIDUAL')}
    </span>
  )
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const params = await searchParams
  const type = params.type
  const scored = params.scored ?? '1'
  const absentee = params.absentee ?? '1'
  const currentPage = Math.max(1, parseInt(params.page ?? '1', 10))

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
    return `/leads?${params.toString()}`
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        
        <header className="mb-6 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
              Deal Engine
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              High-intent Dallas residential leads
            </p>
          </div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Showing {properties.length} of {total.toLocaleString()} leads
          </div>
        </header>

        <HotLeads leads={hotLeads} />

        <FilterBar activeType={type ?? 'ALL'} absentee={absentee === '1'} scored={scored === '1'} total={total} />

        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          <table className="w-full text-left" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}>
                {['Score', 'Signals', 'Address', 'Owner', 'Type', 'Value', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
  {properties.map((p, index) => (
    <tr 
      key={`${p.id}-${index}`} // Composite key prevents React rendering collisions
      className="hover:bg-[var(--bg-base)] transition-colors" 
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <td style={{ padding: '12px 16px' }}><ScoreBadge score={p.score} /></td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-data)', fontSize: '0.85rem' }}>
        {p.signal_count > 0 ? `🔥 ${p.signal_count}` : '—'}
      </td>
      <td style={{ padding: '12px 16px' }}>
        <Link href={`/leads/${p.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.875rem' }}>
          {p.property_address}
        </Link>
      </td>
      <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.owner_name}</td>
      <td style={{ padding: '12px 16px' }}><TypeBadge type={p.ownership_type} owner={p.owner_name} /></td>
      <td style={{ padding: '12px 16px', fontFamily: 'var(--font-data)', fontSize: '0.8rem' }}>
        {p.assessed_value ? `$${p.assessed_value.toLocaleString()}` : '—'}
      </td>
      <td style={{ padding: '12px 16px' }}>
        {p.is_absentee && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase">absentee</span>}
      </td>
    </tr>
  ))}
</tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-4 mt-8">
            <Link href={buildUrl(currentPage - 1)} className={currentPage === 1 ? 'pointer-events-none opacity-50' : ''}>Previous</Link>
            <span className="font-mono text-sm">{currentPage} / {totalPages}</span>
            <Link href={buildUrl(currentPage + 1)} className={currentPage === totalPages ? 'pointer-events-none opacity-50' : ''}>Next</Link>
          </div>
        )}
      </div>
    </main>
  )
}
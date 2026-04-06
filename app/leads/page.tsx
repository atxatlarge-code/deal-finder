import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import FilterBar from './_components/FilterBar'
import HotLeads, { type HotLead } from './_components/HotLeads'
import { scoreBand } from '@/lib/scoring'

const PAGE_SIZE = 50

// Search params type for Next.js 15
type SearchParams = { [key: string]: string | undefined }

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
 * Data fetcher for the main table
 */
async function fetchProperties(
  type: string | undefined,
  absentee: boolean,
  scored: boolean,
  page: number,
): Promise<{ data: PropertyRow[]; count: number }> {
  const supabase = adminClient()
  const offset = (page - 1) * PAGE_SIZE

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
    .range(offset, offset + PAGE_SIZE - 1)

  if (type && type !== 'ALL') query = query.eq('property.ownership_type', type)
  if (absentee) query = query.eq('property.is_absentee', true)

  const { data, count, error } = await query

  if (error) {
    console.error('Fetch Error:', error)
    return { data: [], count: 0 }
  }

  // 🎯 VERCEL FIX: Flatten the data and handle potential array from join
  const flattened: PropertyRow[] = (data ?? []).map((row: any) => {
    const p = Array.isArray(row.property) ? row.property[0] : row.property
    return {
      ...p,
      score: row.score,
      signal_count: row.signal_count
    }
  })

  return { data: flattened, count: count ?? 0 }
}

/**
 * Data fetcher for the "Hot Leads" bubbles
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

  // Flatten logic for the Hot Leads to prevent .id errors
  const processedScores = scores.map((s: any) => {
    const p = Array.isArray(s.property) ? s.property[0] : s.property
    return { ...s, property: p }
  })

  const ids = processedScores.map(s => s.property?.id).filter(Boolean)

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

  return processedScores.map((s: any): HotLead => ({
    ...s.property,
    score: s.score,
    signal_count: s.signal_count,
    signal_types: [...new Set(signalsByProp.get(s.property.id) ?? [])],
  }))
}

// --- Cached Wrappers ---
const getCachedProperties = unstable_cache(fetchProperties, ['properties-list'], { revalidate: 300 })
const getCachedHotLeads = unstable_cache(fetchHotLeads, ['hot-leads'], { revalidate: 300 })

// --- UI Components ---

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const band = scoreBand(score)
  const colors = {
    high: { bg: 'var(--score-high-bg)', text: 'var(--score-high-text)' },
    med:  { bg: 'var(--score-med-bg)',  text: 'var(--score-med-text)' },
    low:  { bg: 'var(--score-low-bg)',  text: 'var(--score-low-text)' },
  }
  const s = colors[band]
  
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700,
      background: s.bg, color: s.text, minWidth: '32px', textAlign: 'center'
    }}>
      {score}
    </span>
  )
}

function TypeBadge({ type, owner }: { type: string | null; owner: string | null }) {
  const isEstate = type === 'ESTATE' || owner?.includes('EST OF')
  const style = isEstate ? { bg: '#f3e8ff', text: '#7e22ce' } : { bg: 'var(--bg-base)', text: 'var(--text-muted)' }
  
  return (
    <span style={{ padding: '1px 7px', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 600, background: style.bg, color: style.text }}>
      {isEstate ? 'ESTATE' : (type ?? 'INDIVIDUAL')}
    </span>
  )
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const params = await searchParams
  const type = params.type
  const absentee = params.absentee ?? '1'
  const scored = params.scored ?? '1'
  const currentPage = Math.max(1, parseInt(params.page ?? '1', 10))

  const [{ data: properties, count }, hotLeads] = await Promise.all([
    getCachedProperties(type, absentee === '1', scored === '1', currentPage),
    getCachedHotLeads(),
  ])

  const total = count ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-6xl mx-auto px-6 py-8">
        <header className="mb-6 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Deal Engine</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>High-intent Dallas leads</p>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Showing {properties.length} of {total.toLocaleString()} leads
          </div>
        </header>

        <HotLeads leads={hotLeads} />

        {/* Score Explanation */}
        <details className="mb-6 p-4 rounded-lg border" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', cursor: 'pointer' }}>
          <summary style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)', listStyle: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1rem' }}>ℹ️</span> How scores work
          </summary>
          <div style={{ marginTop: '12px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <p style={{ marginBottom: '10px' }}>
              Scores (0-100) predict seller motivation based on distress signals.
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px', fontSize: '0.75rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-muted)' }}>Signal</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-muted)' }}>Points</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-muted)' }}>Signal</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-muted)' }}>Points</th>
                </tr>
              </thead>
              <tbody>
                <tr><td style={{ padding: '4px 6px' }}>Foreclosure</td><td style={{ padding: '4px 6px' }}>40</td><td style={{ padding: '4px 6px' }}>Tax Delinq.</td><td style={{ padding: '4px 6px' }}>30</td></tr>
                <tr><td style={{ padding: '4px 6px' }}>Bankruptcy</td><td style={{ padding: '4px 6px' }}>35</td><td style={{ padding: '4px 6px' }}>Code Viol.</td><td style={{ padding: '4px 6px' }}>20</td></tr>
                <tr><td style={{ padding: '4px 6px' }}>Divorce</td><td style={{ padding: '4px 6px' }}>35</td><td style={{ padding: '4px 6px' }}>Vacant</td><td style={{ padding: '4px 6px' }}>15</td></tr>
                <tr><td style={{ padding: '4px 6px' }}>Emergency</td><td style={{ padding: '4px 6px' }}>100</td><td style={{ padding: '4px 6px' }}>Diversity bonus</td><td style={{ padding: '4px 6px' }}>+10</td></tr>
              </tbody>
            </table>
            <p style={{ marginBottom: '8px' }}>
              <strong>Bonuses:</strong> +15 for absentee owners, +10 for 2+ signal types
            </p>
            <p style={{ marginBottom: '8px' }}>
              <strong>Multipliers:</strong> ESTATE ×1.2, TRUST ×1.15, LLC ×1.1, INDIVIDUAL ×1.0
            </p>
            <p>
              <strong>Bands:</strong> ≥70 = High (black), ≥50 = Medium (gray), {'<50'} = Low
            </p>
          </div>
        </details>

        <FilterBar activeType={type ?? 'ALL'} absentee={absentee === '1'} scored={scored === '1'} total={total} />

        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}>
                {['Score', 'Signals', 'Address', 'Owner', 'Type', 'Value', ''].map(h => (
                  <th key={h} style={{ padding: '12px 16px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="hover:bg-[var(--bg-base)] transition-colors" style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '12px 16px' }}><ScoreBadge score={p.score} /></td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem' }}>{p.signal_count > 0 ? `🔥 ${p.signal_count}` : '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/leads/${p.id}`} style={{ fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.875rem' }}>
                      {p.property_address}
                    </Link>
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.owner_name}</td>
                  <td style={{ padding: '12px 16px' }}><TypeBadge type={p.ownership_type} owner={p.owner_name} /></td>
                  <td style={{ padding: '12px 16px', fontSize: '0.8rem' }}>{p.assessed_value ? `$${p.assessed_value.toLocaleString()}` : '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    {p.is_absentee && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase">absentee</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-4 mt-8">
            <Link href={`/leads?page=${currentPage - 1}`} className={currentPage === 1 ? 'pointer-events-none opacity-30' : ''}>Previous</Link>
            <span style={{ fontSize: '0.875rem' }}>{currentPage} / {totalPages}</span>
            <Link href={`/leads?page=${currentPage + 1}`} className={currentPage === totalPages ? 'pointer-events-none opacity-30' : ''}>Next</Link>
          </div>
        )}
      </div>
    </main>
  )
}
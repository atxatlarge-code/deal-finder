'use client'

import Link from 'next/link'
import { scoreBand, SIGNAL_WEIGHTS } from '@/lib/scoring'

export type HotLead = {
  id: string
  property_address: string
  owner_name: string | null
  ownership_type: string | null
  assessed_value: number | null
  is_absentee: boolean | null
  score: number
  signal_count: number
  signal_types: string[]
}

// Generate plain-english reasons why this lead scored high
function buildReasons(lead: HotLead): string[] {
  const reasons: string[] = []

  // Signals — most impactful first
  const sorted = [...lead.signal_types].sort(
    (a, b) => (SIGNAL_WEIGHTS[b] ?? 0) - (SIGNAL_WEIGHTS[a] ?? 0)
  )
  
  for (const type of sorted) {
    const label: Record<string, string> = {
      BANKRUPTCY:      'bankruptcy filing', 
      FORECLOSURE:     'foreclosure filing',
      DIVORCE:         'divorce filing',
      TAX_DELINQUENCY: 'tax delinquent',
      CODE_VIOLATION:  `${lead.signal_count} code violation${lead.signal_count !== 1 ? 's' : ''}`,
      VACANT:          'vacant property',
    }
    if (label[type]) reasons.push(label[type])
  }

  if (lead.is_absentee) reasons.push('absentee owner')

  if (lead.ownership_type === 'ESTATE')  reasons.push('estate sale')
  else if (lead.ownership_type === 'TRUST') reasons.push('trust-owned')
  else if (lead.ownership_type === 'LLC')   reasons.push('LLC-owned')

  if (lead.assessed_value && lead.assessed_value >= 300_000)
    reasons.push(`$${Math.round(lead.assessed_value / 1000)}k assessed`)

  return reasons
}

const SCORE_STYLES = {
  high: { bg: 'var(--score-high-bg)', text: 'var(--score-high-text)' },
  med:  { bg: 'var(--score-med-bg)',  text: 'var(--score-med-text)' },
  low:  { bg: 'var(--score-low-bg)',  text: 'var(--score-low-text)' },
}

const BANKRUPTCY_STYLE = {
  border: '1px solid #f59e0b', 
  background: 'rgba(245, 158, 11, 0.05)',
  badge: { bg: '#f59e0b', text: '#fff' }
}

export default function HotLeads({ leads }: { leads: HotLead[] }) {
  if (leads.length === 0) return null

  // --- THE CHANGE IS HERE ---
  // This ensures we only show the top 10 leads, even if the parent sends more
  const displayLeads = leads.slice(0, 10)

  return (
    <section className="mb-8">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{
          fontSize: '0.75rem', // Slightly larger for the "Top 10" header
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}>
          Top 10 High-Intent Leads
        </p>
      </div>

      <div style={{
        display: 'grid',
        // Changed minmax from 240px to 220px to fit 10 cards more densely
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: '10px',
      }}>
        {displayLeads.map((lead) => { // Changed leads.map to displayLeads.map
          const band = scoreBand(lead.score)
          const scoreStyle = SCORE_STYLES[band]
          const reasons = buildReasons(lead)
          const isBankruptcy = lead.signal_types.includes('BANKRUPTCY')

          return (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  background: isBankruptcy ? BANKRUPTCY_STYLE.background : 'var(--bg-surface)',
                  border: isBankruptcy ? BANKRUPTCY_STYLE.border : '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '16px',
                  height: '100%', // Ensure cards stay same height in the row
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = isBankruptcy ? '#d97706' : 'var(--text-muted)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = isBankruptcy ? BANKRUPTCY_STYLE.border : 'var(--border)')}
              >
                {isBankruptcy && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '40px',
                    height: '40px',
                    background: 'linear-gradient(45deg, transparent 50%, #f59e0b 50%)',
                    opacity: 0.8
                  }} />
                )}

                <div style={{ marginBottom: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    fontFamily: 'var(--font-data)',
                    background: scoreStyle.bg,
                    color: scoreStyle.text,
                  }}>
                    {lead.score}
                  </span>
                  
                  {isBankruptcy && (
                    <span style={{
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: '#b45309',
                      letterSpacing: '0.02em'
                    }}>
                      High Intent
                    </span>
                  )}
                </div>

                <p style={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  marginBottom: '2px',
                  lineHeight: 1.3,
                }}>
                  {lead.property_address}
                </p>

                <p style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {lead.owner_name ?? '—'}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {reasons.map((r) => {
                    const isBankruptcyTag = r === 'bankruptcy filing';
                    return (
                      <span key={r} style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: '9999px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        background: isBankruptcyTag ? '#fef3c7' : 'var(--bg-base)',
                        color: isBankruptcyTag ? '#92400e' : 'var(--text-secondary)',
                        border: isBankruptcyTag ? '1px solid #fcd34d' : '1px solid var(--border)',
                      }}>
                        {r}
                      </span>
                    )
                  })}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
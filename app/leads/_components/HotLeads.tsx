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

export default function HotLeads({ leads }: { leads: HotLead[] }) {
  if (leads.length === 0) return null

  return (
    <section className="mb-8">
      <p style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: '10px',
      }}>
        Hot Leads
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '10px',
      }}>
        {leads.map((lead) => {
          const band = scoreBand(lead.score)
          const scoreStyle = SCORE_STYLES[band]
          const reasons = buildReasons(lead)

          return (
            <Link
              key={lead.id}
              href={`/leads/${lead.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '16px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text-muted)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              >
                {/* Score */}
                <div style={{ marginBottom: '10px' }}>
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
                </div>

                {/* Address */}
                <p style={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: 'var(--text-primary)',
                  marginBottom: '2px',
                  lineHeight: 1.3,
                }}>
                  {lead.property_address}
                </p>

                {/* Owner */}
                <p style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  marginBottom: '12px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {lead.owner_name ?? '—'}
                </p>

                {/* Reason tags */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {reasons.map((r) => (
                    <span key={r} style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      borderRadius: '9999px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                    }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

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
  is_emergency?: boolean 
}

function buildReasons(lead: HotLead): string[] {
  const reasons: string[] = []
  
  // 1. Emergency Flag
  if (lead.is_emergency) {
    reasons.push('🚨 EMERGENCY: SUBSTANDARD');
  }

  // 2. Map signals
  for (const type of lead.signal_types) {
    if (type === 'BANKRUPTCY') reasons.push('bankruptcy filing');
    if (type === 'CODE_VIOLATION' && !lead.is_emergency) {
       reasons.push(`${lead.signal_count} code violations`);
    }
  }

  // 3. RESTORED: Absentee Check
  if (lead.is_absentee) {
    reasons.push('absentee owner');
  }

  // 4. Ownership Details
  if (lead.ownership_type === 'ESTATE')  reasons.push('estate sale')
  else if (lead.ownership_type === 'TRUST') reasons.push('trust-owned')
  else if (lead.ownership_type === 'LLC')   reasons.push('LLC-owned')

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
  text: '#b45309'
}

const EMERGENCY_STYLE = {
  border: '1px solid #ef4444', 
  background: 'rgba(239, 68, 68, 0.05)',
  text: '#b91c1c',
  badge: { bg: '#fee2e2', text: '#991b1b', border: '#fecaca' }
}

// New Blue style for Absentee
const ABSENTEE_STYLE = {
  bg: '#e0f2fe',
  text: '#0369a1',
  border: '#bae6fd'
}

export default function HotLeads({ leads }: { leads: HotLead[] }) {
  if (leads.length === 0) return null

  const displayLeads = leads.slice(0, 10)

  return (
    <section className="mb-8">
      <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
        Top 10 High-Intent Leads
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
        {displayLeads.map((lead) => {
          const band = scoreBand(lead.score)
          const scoreStyle = SCORE_STYLES[band]
          const reasons = buildReasons(lead)
          
          const isBankruptcy = lead.signal_types.includes('BANKRUPTCY')
          const isEmergency = lead.is_emergency || lead.signal_types.includes('EMERGENCY')

          const activeStyle = isEmergency ? EMERGENCY_STYLE : (isBankruptcy ? BANKRUPTCY_STYLE : null)

          return (
            <Link key={lead.id} href={`/leads/${lead.id}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: activeStyle ? activeStyle.background : 'var(--bg-surface)',
                  border: activeStyle ? activeStyle.border : '1px solid var(--border)',
                  borderRadius: '10px',
                  padding: '16px',
                  height: '100%',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease-in-out',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                {activeStyle && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '40px',
                    height: '40px',
                    background: `linear-gradient(45deg, transparent 50%, ${isEmergency ? '#ef4444' : '#f59e0b'} 50%)`,
                    opacity: 0.8
                  }} />
                )}

                <div style={{ marginBottom: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    background: scoreStyle.bg,
                    color: scoreStyle.text,
                  }}>
                    {lead.score}
                  </span>
                  
                  {activeStyle && (
                    <span style={{
                      fontSize: '0.6rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: activeStyle.text,
                      letterSpacing: '0.02em'
                    }}>
                      {isEmergency ? '⚠️ Emergency' : 'High Intent'}
                    </span>
                  )}
                </div>

                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {lead.property_address}
                </p>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lead.owner_name ?? '—'}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {reasons.map((r) => {
                    // Logic to apply color coding to badges
                    const isBankruptcyTag = r === 'bankruptcy filing';
                    const isEmergencyTag = r === '🚨 EMERGENCY: SUBSTANDARD';
                    const isAbsenteeTag = r === 'absentee owner';

                    let currentTagStyle = {
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)'
                    };

                    if (isEmergencyTag) {
                      currentTagStyle = { background: EMERGENCY_STYLE.badge.bg, color: EMERGENCY_STYLE.badge.text, border: `1px solid ${EMERGENCY_STYLE.badge.border}` };
                    } else if (isBankruptcyTag) {
                      currentTagStyle = { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
                    } else if (isAbsenteeTag) {
                      currentTagStyle = { background: ABSENTEE_STYLE.bg, color: ABSENTEE_STYLE.text, border: `1px solid ${ABSENTEE_STYLE.border}` };
                    }

                    return (
                      <span key={r} style={{
                        padding: '2px 7px',
                        borderRadius: '9999px',
                        fontSize: '0.65rem',
                        fontWeight: 600,
                        textTransform: 'uppercase', // Consistent button-like look
                        ...currentTagStyle
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
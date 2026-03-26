'use client'

import Link from 'next/link'
import { scoreBand } from '@/lib/scoring'
import { Zap, AlertTriangle } from 'lucide-react'

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
  has_city_pressure?: boolean 
}

// --- CONSTANTS (RESTORED) ---
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

const ABSENTEE_STYLE = {
  bg: '#e0f2fe',
  text: '#0369a1',
  border: '#bae6fd'
}

function buildReasons(lead: HotLead): string[] {
  const reasons: string[] = []
  
  if (lead.is_emergency || lead.signal_types.includes('EMERGENCY')) {
    reasons.push('🚨 EMERGENCY: CCS');
  }

  if (lead.signal_count > 2) {
    reasons.push('HIGH ENFORCEMENT');
  }

  for (const type of lead.signal_types) {
    if (type === 'BANKRUPTCY') reasons.push('bankruptcy');
    if (type === 'CODE_VIOLATION' && !lead.is_emergency) {
       reasons.push(`CCS: ${lead.signal_count} CASES`);
    }
  }

  if (lead.is_absentee) reasons.push('absentee');
  if (lead.ownership_type === 'ESTATE') reasons.push('estate')
  else if (lead.ownership_type === 'TRUST') reasons.push('trust')

  return reasons
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
          const hasPressure = isEmergency || lead.signal_count >= 3;

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
                  position: 'relative',
                  overflow: 'hidden',
                  boxShadow: hasPressure ? '0 0 15px rgba(245, 158, 11, 0.1)' : 'none'
                }}
              >
                {activeStyle && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '32px',
                    height: '32px',
                    background: `linear-gradient(45deg, transparent 50%, ${isEmergency ? '#ef4444' : '#f59e0b'} 50%)`,
                    opacity: 0.8
                  }} />
                )}

                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
                    
                    {hasPressure && (
                      <div className="flex items-center gap-1 animate-pulse" style={{ color: '#d97706' }}>
                        <Zap size={12} fill="#d97706" />
                        <span style={{ fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase' }}>Pressure</span>
                      </div>
                    )}
                  </div>
                </div>

                <p style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {lead.property_address}
                </p>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {lead.owner_name ?? '—'}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {reasons.map((r) => {
                    const isBankruptcyTag = r === 'bankruptcy';
                    const isEmergencyTag = r.includes('EMERGENCY');
                    const isAbsenteeTag = r === 'absentee';
                    const isEnforcementTag = r === 'HIGH ENFORCEMENT';

                    let currentTagStyle = {
                      background: 'var(--bg-base)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)'
                    };

                    if (isEmergencyTag) {
                      currentTagStyle = { background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' };
                    } else if (isEnforcementTag) {
                      currentTagStyle = { background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a' };
                    } else if (isBankruptcyTag) {
                      currentTagStyle = { background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d' };
                    } else if (isAbsenteeTag) {
                      currentTagStyle = { background: ABSENTEE_STYLE.bg, color: ABSENTEE_STYLE.text, border: `1px solid ${ABSENTEE_STYLE.border}` };
                    }

                    return (
                      <span key={r} style={{
                        padding: '2px 7px',
                        borderRadius: '4px',
                        fontSize: '0.55rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
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
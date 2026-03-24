import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { scoreBand, SIGNAL_WEIGHTS } from '@/lib/scoring'

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  LLC:        { bg: 'var(--tag-code-bg)',    text: 'var(--tag-code-text)' },
  TRUST:      { bg: 'var(--tag-trust-bg)',   text: 'var(--tag-trust-text)' },
  ESTATE:     { bg: 'var(--tag-divorce-bg)', text: 'var(--tag-divorce-text)' },
  INDIVIDUAL: { bg: 'var(--bg-base)',        text: 'var(--text-muted)' },
}

const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  FORECLOSURE:      { bg: 'var(--tag-divorce-bg)',  text: 'var(--tag-divorce-text)',  label: 'Foreclosure' },
  DIVORCE:          { bg: 'var(--tag-divorce-bg)',  text: 'var(--tag-divorce-text)',  label: 'Divorce' },
  TAX_DELINQUENCY:  { bg: 'var(--tag-tax-bg)',      text: 'var(--tag-tax-text)',      label: 'Tax Delinquency' },
  CODE_VIOLATION:   { bg: 'var(--tag-code-bg)',     text: 'var(--tag-code-text)',     label: 'Code Violation' },
  VACANT:      { bg: 'var(--tag-vacant-bg)',      text: 'var(--tag-vacant-text)',      label: 'Vacant' },
  BANKRUPTCY:  { bg: 'var(--tag-bankruptcy-bg)', text: 'var(--tag-bankruptcy-text)', label: 'Bankruptcy' },
}

const SCORE_STYLES = {
  high: { bg: 'var(--score-high-bg)', text: 'var(--score-high-text)' },
  med:  { bg: 'var(--score-med-bg)',  text: 'var(--score-med-text)' },
  low:  { bg: 'var(--score-low-bg)',  text: 'var(--score-low-text)' },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [{ data: property }, { data: signals }, { data: scores }] = await Promise.all([
    supabase.from('properties').select('*').eq('id', id).single(),
    supabase
      .from('signals')
      .select('id, signal_type, case_number, filed_at, description, source_url')
      .eq('property_id', id)
      .order('filed_at', { ascending: false }),
    supabase
      .from('lead_scores')
      .select('score, signal_count, scored_at, expires_at')
      .eq('property_id', id)
      .gt('expires_at', new Date().toISOString())
      .order('scored_at', { ascending: false })
      .limit(1),
  ])

  if (!property) notFound()

  const latestScore = scores?.[0] ?? null

  const typeStyle = TYPE_STYLES[property.ownership_type] ?? TYPE_STYLES.INDIVIDUAL

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Back */}
        <Link
          href="/leads"
          style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'none' }}
        >
          ← Leads
        </Link>

        {/* Heading */}
        <div className="mt-4 mb-6">
          <h1
            className="text-xl font-semibold"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', lineHeight: 1.3 }}
          >
            {property.property_address}
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-data)',
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              marginTop: '4px',
            }}
          >
            {property.parcel_id}
          </p>
        </div>

        {/* Two-column info cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>

          {/* Owner card */}
          <div
            className="rounded-lg border p-5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
              Owner
            </p>
            <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '8px' }}>
              {property.owner_name ?? '—'}
            </p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {property.ownership_type && (
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  background: typeStyle.bg,
                  color: typeStyle.text,
                }}>
                  {property.ownership_type}
                </span>
              )}
              {property.is_absentee && (
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  background: 'var(--tag-absentee-bg)',
                  color: 'var(--tag-absentee-text)',
                }}>
                  absentee
                </span>
              )}
            </div>
          </div>

          {/* Value card */}
          <div
            className="rounded-lg border p-5"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
              Assessed Value
            </p>
            <p style={{
              fontFamily: 'var(--font-data)',
              fontSize: '1.4rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '6px',
            }}>
              {property.assessed_value != null
                ? `$${property.assessed_value.toLocaleString()}`
                : '—'}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Equity: {property.equity != null ? `$${property.equity.toLocaleString()}` : 'not calculated'}
            </p>
          </div>
        </div>

        {/* Mailing address card */}
        {property.mailing_address && (
          <div
            className="rounded-lg border p-5 mb-4"
            style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
          >
            <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Mailing Address {property.is_absentee ? '· owner not on-site' : '· matches property'}
            </p>
            <p style={{
              fontFamily: 'var(--font-data)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-line',
              lineHeight: 1.6,
            }}>
              {property.mailing_address}
            </p>
          </div>
        )}

        {/* Score */}
        <div
          className="rounded-lg border p-5 mb-4"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '10px' }}>
            Seller-Intent Score
          </p>
          {latestScore ? (() => {
            const band = scoreBand(latestScore.score)
            const s = SCORE_STYLES[band]
            return (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                <span style={{
                  display: 'inline-block',
                  padding: '4px 14px',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-data)',
                  fontSize: '1.6rem',
                  fontWeight: 700,
                  background: s.bg,
                  color: s.text,
                }}>
                  {latestScore.score}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {latestScore.signal_count} signal{latestScore.signal_count !== 1 ? 's' : ''} ·{' '}
                  scored {new Date(latestScore.scored_at).toLocaleDateString()}
                </span>
              </div>
            )
          })() : (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
              Not scored yet — run the scoring cron after signals are imported.
            </p>
          )}
        </div>

        {/* Signals */}
        <div
          className="rounded-lg border overflow-hidden"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p style={{
            fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--text-muted)',
            padding: '16px 20px 12px',
            borderBottom: signals && signals.length > 0 ? '1px solid var(--border)' : 'none',
          }}>
            Signals {signals && signals.length > 0 ? `· ${signals.length}` : ''}
          </p>
          {!signals || signals.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', padding: '12px 20px 16px' }}>
              No signals on file.
            </p>
          ) : (
            <div>
              {signals.map((sig) => {
                const style = SIGNAL_STYLES[sig.signal_type] ?? { bg: 'var(--bg-base)', text: 'var(--text-secondary)', label: sig.signal_type }
                const weight = SIGNAL_WEIGHTS[sig.signal_type] ?? 10
                return (
                  <div
                    key={sig.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '12px',
                      padding: '12px 20px',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      background: style.bg,
                      color: style.text,
                    }}>
                      {style.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {sig.case_number && (
                        <p style={{
                          fontFamily: 'var(--font-data)',
                          fontSize: '0.75rem',
                          color: 'var(--text-secondary)',
                          marginBottom: sig.description ? '2px' : 0,
                        }}>
                          {sig.source_url ? (
                            <a href={sig.source_url} target="_blank" rel="noopener noreferrer"
                              style={{ color: 'inherit', textDecoration: 'underline', textDecorationColor: 'var(--border)' }}>
                              {sig.case_number}
                            </a>
                          ) : sig.case_number}
                        </p>
                      )}
                      {sig.description && (
                        <p style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {sig.description}
                        </p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontFamily: 'var(--font-data)', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {sig.filed_at ? new Date(sig.filed_at).toLocaleDateString() : '—'}
                      </p>
                      <p style={{ fontFamily: 'var(--font-data)', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        +{weight} pts
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}

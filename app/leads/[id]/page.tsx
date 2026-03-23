import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'

const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  LLC:        { bg: 'var(--tag-code-bg)',    text: 'var(--tag-code-text)' },
  TRUST:      { bg: 'var(--tag-trust-bg)',   text: 'var(--tag-trust-text)' },
  ESTATE:     { bg: 'var(--tag-divorce-bg)', text: 'var(--tag-divorce-text)' },
  INDIVIDUAL: { bg: 'var(--bg-base)',        text: 'var(--text-muted)' },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: property } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .single()

  if (!property) notFound()

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

        {/* Signals placeholder */}
        <div
          className="rounded-lg border p-5 mb-4"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Signals
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
            No signals yet — pending data import.
          </p>
        </div>

        {/* Score placeholder */}
        <div
          className="rounded-lg border p-5"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <p style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
            Seller-Intent Score
          </p>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
            Not scored yet — run the scoring cron after signals are imported.
          </p>
        </div>

      </div>
    </main>
  )
}

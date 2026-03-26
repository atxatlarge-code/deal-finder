import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Info, Clock, Zap, Phone, ShieldAlert, CheckCircle2 } from 'lucide-react'

// 1. Styling Constants
const TYPE_STYLES: Record<string, { bg: string; text: string }> = {
  LLC:        { bg: 'var(--tag-code-bg)',    text: 'var(--tag-code-text)' },
  TRUST:      { bg: 'var(--tag-trust-bg)',   text: 'var(--tag-trust-text)' },
  ESTATE:     { bg: '#f3e8ff',               text: '#7e22ce' }, 
  INDIVIDUAL: { bg: 'var(--bg-base)',        text: 'var(--text-muted)' },
}

const SIGNAL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  EMERGENCY:        { bg: '#fee2e2',  text: '#991b1b',  label: '🚨 EMERGENCY' },
  CODE_VIOLATION:   { bg: 'var(--tag-code-bg)',     text: 'var(--tag-code-text)',     label: 'Code Violation' },
  BANKRUPTCY:       { bg: 'var(--tag-bankruptcy-bg)', text: 'var(--tag-bankruptcy-text)', label: 'Bankruptcy' },
  VACANT:           { bg: 'var(--tag-vacant-bg)',   text: 'var(--tag-vacant-text)',   label: 'Vacant' },
}

const getOfficialLabel = (type: string, description: string) => {
  const upperType = type?.toUpperCase() || '';
  const desc = description?.toUpperCase() || '';
  if (upperType === 'EMERGENCY' || desc.includes('EMERGENCY')) return '🚨 Emergency Request';
  if (upperType === 'CODE_VIOLATION' || desc.includes('CCS')) return 'Code Compliance (CCS)';
  return 'Service Request (SR)';
};

interface Props {
  params: Promise<{ id: string }>
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // 🎯 UNIFIED FETCH: Fetch property and signals in one joined request
  const { data: property, error } = await supabase
    .from('properties')
    .select(`
      *,
      signals (*)
    `)
    .eq('id', id)
    .single();

  if (!property || error) redirect('/leads');

  // Sort signals by date (Newest First)
  const signals = [...(property.signals || [])].sort((a, b) => 
    new Date(b.filed_at).getTime() - new Date(a.filed_at).getTime()
  );

  const isEstate = property.ownership_type === 'ESTATE' || property.owner_name?.includes('EST OF');
  const typeStyle = isEstate ? TYPE_STYLES.ESTATE : (TYPE_STYLES[property.ownership_type] ?? TYPE_STYLES.INDIVIDUAL);

  const latestEmergency = signals?.find(s => s.raw_data?.priority === 'Emergency');
  const deadline = latestEmergency?.raw_data?.ert_estimated_response_time;
  const openCases = signals?.filter(s => s.status?.toUpperCase() === 'OPEN') || [];

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        
        <Link href="/leads" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
          ← Back to Leads
        </Link>

        <header className="mt-4 mb-6 flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-ui)' }}>
              {property.property_address}
            </h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
              {property.parcel_id}
            </p>
          </div>
          <div className="text-right">
            <p style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lead Score</p>
            <p style={{ fontSize: '1.25rem', fontWeight: 900, color: '#2563eb' }}>{property.score || 0}</p>
          </div>
        </header>

        {/* 1. Pressure Timeline Summary */}
        {signals.length > 0 && (
          <div className="rounded-lg border mb-4 overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <div style={{ padding: '12px 20px', background: 'rgba(0,0,0,0.02)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldAlert size={12} className="text-blue-600" /> City Pressure Timeline
              </p>
              {openCases.length > 0 && (
                <span style={{ fontSize: '0.6rem', background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '4px', fontWeight: 900, border: '1px solid #fecaca' }}>
                  {openCases.length} ACTIVE VIOLATIONS
                </span>
              )}
            </div>
            
            <div style={{ padding: '24px 20px', position: 'relative' }}>
              <div style={{ position: 'absolute', left: '35px', top: '24px', bottom: '24px', width: '2px', background: 'var(--border)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {signals.slice(0, 3).map((sig) => {
                  const isOpen = sig.status?.toUpperCase() === 'OPEN';
                  return (
                    <div key={sig.id} style={{ display: 'flex', gap: '16px', position: 'relative', zIndex: 1 }}>
                      <div style={{ 
                        width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: isOpen ? '#ef4444' : 'var(--bg-base)', border: '4px solid var(--bg-surface)', color: isOpen ? 'white' : 'var(--text-muted)'
                      }}>
                        {isOpen ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                           <p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)' }}>{new Date(sig.filed_at).toLocaleDateString()}</p>
                           {isOpen && <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#ef4444' }}>• ACTIVE</span>}
                        </div>
                        <p style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>{getOfficialLabel(sig.signal_type, sig.description)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* 2. Info Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div className="rounded-lg border p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Owner</p>
            <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{property.owner_name ?? '—'}</p>
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
              <span style={{ padding: '2px 10px', borderRadius: '9999px', fontSize: '0.7rem', fontWeight: 800, background: typeStyle.bg, color: typeStyle.text }}>
                {isEstate ? 'PROBATE / ESTATE' : (property.ownership_type ?? 'INDIVIDUAL')}
              </span>
            </div>
          </div>

          <div className="rounded-lg border p-5" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>Asset Value</p>
            <p style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-data)' }}>
              {property.assessed_value ? `$${property.assessed_value.toLocaleString()}` : '—'}
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Equity: {property.equity ? `$${property.equity.toLocaleString()}` : 'not calculated'}</p>
          </div>
        </div>

        {/* 3. Detailed Signal History Section */}
        <div className="rounded-lg border overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}>
          <p style={{ padding: '16px 20px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Official Violation History · {signals.length} Found
          </p>
          
          {signals.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600 }}>No enforcement history found for this address.</p>
            </div>
          ) : signals.map((sig) => {
            const isEm = sig.signal_type === 'EMERGENCY' || (sig.description || '').toUpperCase().includes('EMERGENCY');
            const isOpen = sig.status?.toUpperCase() === 'OPEN';
            const style = isEm ? SIGNAL_STYLES.EMERGENCY : (SIGNAL_STYLES[sig.signal_type] ?? { bg: 'var(--bg-base)', text: 'var(--text-secondary)', label: sig.signal_type });
            
            return (
              <div key={sig.id} style={{ display: 'flex', padding: '16px 20px', borderBottom: '1px solid var(--border)', background: isOpen ? 'rgba(239, 68, 68, 0.04)' : 'transparent', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '0.55rem', fontWeight: 900, background: isOpen ? '#fee2e2' : '#f1f5f9', color: isOpen ? '#b91c1c' : '#64748b', border: '1px solid', borderColor: isOpen ? '#fecaca' : '#e2e8f0', textTransform: 'uppercase' }}>
                      {sig.status ?? 'CLOSED'}
                    </span>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 900, background: style.bg, color: style.text, textTransform: 'uppercase' }}>{style.label}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{sig.case_number}</span>
                  </div>
                  
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {sig.description || sig.raw_data?.nuisance || sig.raw_data?.type || 'City code compliance activity recorded.'}
                  </p>
                  
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Zap size={10} /> Reported via: {sig.raw_data?.method_received_description || 'System'}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.7rem', marginLeft: '16px' }}>
                  <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontWeight: 600 }}>{new Date(sig.filed_at).toLocaleDateString()}</p>
                  <p style={{ fontWeight: 800, color: isOpen ? '#b91c1c' : 'var(--text-muted)', marginTop: '4px' }}>+{isOpen ? '50' : '10'} PTS</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* 4. Action Section */}
        {isEstate && (
          <div style={{ marginTop: '24px' }}>
            <button style={{ 
              width: '100%', padding: '16px', background: '#7e22ce', color: 'white', fontWeight: 800, borderRadius: '12px', border: 'none', 
              boxShadow: '0 4px 12px rgba(126, 34, 206, 0.25)', textTransform: 'uppercase', letterSpacing: '0.025em'
            }}>
              RESEARCH {property.owner_name?.split(' ')[0]} ESTATE HEIRS
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
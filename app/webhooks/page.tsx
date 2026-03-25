import { createClient } from '@/lib/supabase/server'

export default async function WebhookFeed() {
  const supabase = await createClient()
  
  // Fetch latest 50 logs
  const { data: logs } = await supabase
    .from('webhook_logs')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(50)

  return (
    <main className="max-w-6xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Incoming Signal Feed
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>Raw CourtListener Webhook Events</p>
      </header>

      <div className="space-y-4">
        {logs?.map((log) => (
          <div 
            key={log.id} 
            className="p-4 rounded-lg border bg-surface"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
          >
            <div className="flex justify-between items-start mb-2">
              <span className="font-mono text-xs text-muted">
                {new Date(log.received_at).toLocaleString()}
              </span>
              <span className="px-2 py-1 rounded text-xs font-bold uppercase" 
                style={{ 
                  background: log.status === 'received' ? 'var(--tag-code-bg)' : 'var(--tag-divorce-bg)',
                  color: log.status === 'received' ? 'var(--tag-code-text)' : 'var(--tag-divorce-text)'
                }}>
                {log.status}
              </span>
            </div>
            
            <pre className="text-xs p-3 rounded bg-black/10 overflow-x-auto" style={{ color: 'var(--text-secondary)' }}>
              {JSON.stringify(log.payload, null, 2).substring(0, 500)}...
            </pre>
          </div>
        ))}

        {(!logs || logs.length === 0) && (
          <div className="p-12 text-center border-2 border-dashed rounded-lg" style={{ borderColor: 'var(--border)' }}>
            <p style={{ color: 'var(--text-muted)' }}>No signals received yet. Waiting for CourtListener...</p>
          </div>
        )}
      </div>
    </main>
  )
}

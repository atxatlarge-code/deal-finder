import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const payload = await req.json()

    // 1. Log the raw event
    const { error: logError } = await supabase
      .from('webhook_logs')
      .insert({ payload, status: 'received' })

    if (logError) throw logError

    // 2. TRIGGER SCORING (The "PMP" Handshake)
    // We don't "await" this because we want to tell CourtListener "Success!" 
    // immediately so they don't timeout. The scoring happens in the background.
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
    
    fetch(`${baseUrl}/api/cron/score`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trigger: 'webhook', payload })
    }).catch(err => console.error("Background scoring trigger failed:", err))

    return NextResponse.json({ success: true, message: 'Signal logged and scoring triggered' })
  } catch (err) {
    console.error('Webhook Error:', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

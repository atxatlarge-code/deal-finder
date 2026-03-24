import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch property to get mailing address for skip trace
  const { data: property, error } = await supabase
    .from('properties')
    .select('id, owner_name, mailing_address')
    .eq('id', id)
    .single()

  if (error || !property) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  }

  // TODO: Integrate skip trace provider (BatchSkipTracing, IDI, TLO)
  // IMPORTANT: Do NOT store any returned PII in the database.
  // Return raw provider response to client only.
  return NextResponse.json({
    status: 'not_implemented',
    message: 'Skip trace provider integration pending.',
    property_id: property.id,
  })
}

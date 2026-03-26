import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Log the incoming request to debug
  console.log('Auth Callback Triggered. Code present:', !!code)

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, // Force failure if missing
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // Force failure if missing
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch (error) {
              // This is common in Server Components, safe to ignore if redirecting
            }
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      console.log('Session exchanged successfully. Redirecting to /leads')
      return NextResponse.redirect(`${origin}/leads`)
    } else {
      console.error('Supabase Auth Exchange Error:', error.message)
    }
  }

  // If we got here, something failed
  return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
}
import { NextResponse, type NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Auth routes and API routes are always allowed through
  if (pathname.startsWith('/auth') || pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  // Check for Supabase session cookie (sb-<project-ref>-auth-token)
  const hasSession = request.cookies.getAll().some(
    c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
  )

  if (!hasSession) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

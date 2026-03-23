'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: 'var(--bg-base)' }}
      >
        <div
          className="w-full max-w-sm rounded-lg border p-8 text-center"
          style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
        >
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            Check your email
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            We sent a magic link to <strong>{email}</strong>.<br />
            Click the link to sign in.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-8"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)' }}
      >
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Deal Finder
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Sign in to access your Dallas leads.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
            className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-2"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              background: 'var(--bg-surface)',
            }}
          />
          {error && (
            <p className="text-sm" style={{ color: 'var(--tag-divorce-text)' }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-1 w-full rounded px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--text-primary)',
              color: '#ffffff',
            }}
          >
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      </div>
    </main>
  )
}

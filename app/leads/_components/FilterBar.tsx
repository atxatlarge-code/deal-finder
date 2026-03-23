'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

const TYPES = ['ALL', 'INDIVIDUAL', 'LLC', 'TRUST', 'ESTATE'] as const

export default function FilterBar({
  activeType,
  absentee,
  scored,
  total,
}: {
  activeType: string
  absentee: boolean
  scored: boolean
  total: number
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('page')
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) params.delete(k)
        else params.set(k, v)
      }
      router.push(`/leads?${params.toString()}`)
    },
    [router, searchParams]
  )

  return (
    <div className="flex flex-wrap items-center gap-3 mb-5">
      {/* Ownership type chips */}
      <div className="flex gap-1">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => push({ type: t === 'ALL' ? null : t })}
            style={{
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
              border: '1px solid',
              cursor: 'pointer',
              background: activeType === t ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: activeType === t ? '#fff' : 'var(--text-secondary)',
              borderColor: activeType === t ? 'var(--text-primary)' : 'var(--border)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Absentee toggle */}
      <button
        onClick={() => push({ absentee: absentee ? null : '1' })}
        style={{
          padding: '4px 10px',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 500,
          border: '1px solid',
          cursor: 'pointer',
          background: absentee ? 'var(--tag-absentee-bg)' : 'var(--bg-surface)',
          color: absentee ? 'var(--tag-absentee-text)' : 'var(--text-secondary)',
          borderColor: absentee ? 'var(--tag-absentee-text)' : 'var(--border)',
        }}
      >
        Absentee only
      </button>

      {/* Scored toggle */}
      <button
        onClick={() => push({ scored: scored ? null : '1' })}
        style={{
          padding: '4px 10px',
          borderRadius: '9999px',
          fontSize: '0.75rem',
          fontWeight: 500,
          border: '1px solid',
          cursor: 'pointer',
          background: scored ? 'var(--score-high-bg)' : 'var(--bg-surface)',
          color: scored ? 'var(--score-high-text)' : 'var(--text-secondary)',
          borderColor: scored ? 'var(--score-high-bg)' : 'var(--border)',
        }}
      >
        Scored only
      </button>

      {/* Result count */}
      <span
        style={{
          marginLeft: 'auto',
          fontSize: '0.8rem',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-data)',
        }}
      >
        {total.toLocaleString()} properties
      </span>
    </div>
  )
}

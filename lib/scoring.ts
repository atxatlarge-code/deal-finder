/**
 * Seller-intent scoring algorithm — v1
 *
 * Score = min(100, floor((base + absentee_bonus) × ownership_multiplier))
 *
 * Base: sum of per-type weights + diminishing returns for repeated signals
 *       + diversity bonus for 2+ different signal types
 * Absentee bonus: flat +15 before multiplier
 * Ownership multiplier: ESTATE 1.2 › TRUST 1.15 › LLC 1.1 › INDIVIDUAL 1.0
 */

export const SCORE_VERSION = 'v1'

export const SIGNAL_WEIGHTS: Record<string, number> = {
  FORECLOSURE:      40,
  DIVORCE:          35,
  TAX_DELINQUENCY:  30,
  CODE_VIOLATION:   20,
  VACANT:           15,
}

const OWNERSHIP_MULTIPLIERS: Record<string, number> = {
  ESTATE:     1.2,
  TRUST:      1.15,
  LLC:        1.1,
  INDIVIDUAL: 1.0,
}

export function computeScore({
  signals,
  is_absentee,
  ownership_type,
}: {
  signals: Array<{ signal_type: string }>
  is_absentee: boolean | null
  ownership_type: string | null
}): { score: number; signal_count: number } {
  if (signals.length === 0) return { score: 0, signal_count: 0 }

  // Count by type
  const byType = new Map<string, number>()
  for (const s of signals) {
    byType.set(s.signal_type, (byType.get(s.signal_type) ?? 0) + 1)
  }

  // Base: primary weight + up to 3 extra signals of same type at 5pts each
  let base = 0
  for (const [type, count] of byType) {
    base += SIGNAL_WEIGHTS[type] ?? 10
    base += Math.min(3, count - 1) * 5
  }

  // Diversity bonus
  if (byType.size > 1) base += 10

  // Absentee bonus
  if (is_absentee) base += 15

  // Ownership multiplier
  const multiplier = OWNERSHIP_MULTIPLIERS[ownership_type ?? 'INDIVIDUAL'] ?? 1.0

  return {
    score: Math.min(100, Math.round(base * multiplier)),
    signal_count: signals.length,
  }
}

export function scoreBand(score: number): 'high' | 'med' | 'low' {
  if (score >= 70) return 'high'
  if (score >= 50) return 'med'
  return 'low'
}

/**
 * CourtListener API client for TXNB bankruptcy docket fetching.
 * Docs: https://www.courtlistener.com/api/rest/v4/
 */

const BASE = 'https://www.courtlistener.com/api/rest/v4'

export interface Party {
  id: number
  name: string
  extra_info: string
  party_types: Array<{ name: string }>
}

export interface Docket {
  id: number
  docket_number: string
  absolute_url: string
  date_filed: string
  case_name: string
  bankruptcy_information?: {
    chapter: string
  } | null
}

interface PartiesResponse {
  count: number
  next: string | null
  results: Party[]
}

/**
 * Fetch debtor parties for a given docket ID.
 * Filters party_types to only return 'Debtor' entries.
 */
export async function fetchDebtorParties(docketId: string | number): Promise<Party[]> {
  const token = process.env.COURTLISTENER_TOKEN
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  if (token) headers['Authorization'] = `Token ${token}`

  const url = `${BASE}/parties/?docket=${docketId}&page_size=20`
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`CourtListener parties fetch failed: ${res.status} ${res.statusText}`)
  }
  const data: PartiesResponse = await res.json()

  return data.results.filter(p =>
    p.party_types.some(pt => pt.name === 'Debtor')
  )
}

/**
 * Parse debtor extra_info string to extract a Dallas street address.
 * Input: "2847 ELM ST, DALLAS, TX 75201" or multi-line variants.
 * Returns: "2847 ELM ST" (uppercase, trimmed) if address is in Dallas TX, else null.
 */
export function parseDebtorAddress(extraInfo: string): string | null {
  if (!extraInfo) return null

  // Normalize: collapse newlines/multiple spaces, trim
  const normalized = extraInfo.replace(/\r?\n/g, ', ').replace(/\s+/g, ' ').trim()

  // Must mention DALLAS and TX to qualify
  const upper = normalized.toUpperCase()
  if (!upper.includes('DALLAS') || !upper.includes('TX')) return null

  // Split on first comma — everything before is the street address
  const firstComma = normalized.indexOf(',')
  if (firstComma === -1) return null

  const street = normalized.slice(0, firstComma).trim().toUpperCase()
  if (!street || street.length < 4) return null

  return street
}

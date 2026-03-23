export type SignalType =
  | 'CODE_VIOLATION'
  | 'TAX_DELINQUENCY'
  | 'DIVORCE'
  | 'FORECLOSURE'
  | 'VACANT'

export type OwnershipType = 'INDIVIDUAL' | 'LLC' | 'TRUST' | 'ESTATE' | 'OTHER'

export type LeadStatusType = 'NEW' | 'CONTACTED' | 'SKIPPED'

export interface Property {
  id: string
  parcel_id: string
  property_address: string
  mailing_address: string | null
  owner_name: string | null
  ownership_type: OwnershipType | null
  assessed_value: number | null
  equity: number | null
  is_absentee: boolean | null
  created_at: string
  updated_at: string
}

export interface Signal {
  id: string
  property_id: string
  signal_type: SignalType
  source: string
  case_number: string | null
  filed_at: string
  raw_data: Record<string, unknown> | null
  created_at: string
}

export interface LeadScore {
  id: string
  property_id: string
  score: number
  signal_count: number
  score_version: string
  scored_at: string
  expires_at: string
}

export interface LeadWithScore extends Property {
  score: number
  signal_count: number
  score_version: string
  scored_at: string
  signals: Signal[]
  status: LeadStatusType
}

-- Deal Finder — Supabase Schema
-- Run this in the Supabase SQL editor

-- Properties (from DCAD ACCOUNT_INFO.csv)
create table properties (
  id uuid primary key default gen_random_uuid(),
  parcel_id text unique not null,
  property_address text not null,
  mailing_address text,
  owner_name text,
  ownership_type text check (ownership_type in ('INDIVIDUAL', 'LLC', 'TRUST', 'ESTATE', 'OTHER')),
  assessed_value numeric,
  equity numeric,
  is_absentee boolean generated always as (property_address != mailing_address) stored,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Signals (violations, court filings, NOD, tax delinquency)
create table signals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  signal_type text not null check (signal_type in ('CODE_VIOLATION', 'TAX_DELINQUENCY', 'DIVORCE', 'FORECLOSURE', 'VACANT')),
  source text not null,          -- e.g. "Dallas 311", "Dallas County Court"
  case_number text,
  filed_at timestamptz not null,
  raw_data jsonb,
  created_at timestamptz default now()
);

-- Lead scores (versioned — algorithm updates don't overwrite history)
create table lead_scores (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  signal_count integer not null default 0,
  score_version text not null default 'v1',
  scored_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '180 days')
);

-- Per-user lead status
create table lead_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  status text not null check (status in ('NEW', 'CONTACTED', 'SKIPPED')),
  updated_at timestamptz default now(),
  unique(user_id, property_id)
);

-- Indexes
create index on signals(property_id, filed_at desc);
create index on lead_scores(property_id, scored_at desc);
create index on lead_scores(score desc, expires_at desc);
create index on lead_status(user_id, status);

-- Agency operating layer.
-- Adds: workspace users, activity log, roster fields, casting pipeline,
-- brand campaigns + assignments, content briefs, comm log, compliance, trends,
-- monthly creator statements, campaign reports.

-- 1. Workspace users + roles. Single-tenant for now (one agency = whole DB);
-- multi-tenant comes later via row-level workspace_id columns if needed.
create type user_role as enum ('owner', 'manager', 'coordinator', 'viewer');

create table workspace_users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  name text not null,
  role user_role not null default 'coordinator',
  slack_user_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Activity log. Every meaningful state change writes here. Used for audit
-- and per-coordinator digests.
create table activity_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references workspace_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_created_idx on activity_log (created_at desc);
create index activity_log_entity_idx on activity_log (entity_type, entity_id);

-- 3. Roster fields on creators.
create type creator_tier as enum ('a', 'b', 'c', 'dev');

alter table creators
  add column assigned_coordinator_id uuid references workspace_users(id) on delete set null,
  add column tier creator_tier,
  add column signed_at date,
  add column commission_pct numeric(5, 2),  -- e.g. 15.00
  add column tags text[];

create index creators_coordinator_idx on creators (assigned_coordinator_id) where status = 'active';

-- 4. Casting pipeline. Candidates being evaluated for the roster.
create type candidate_stage as enum (
  'discovered',
  'reaching_out',
  'in_conversation',
  'tryout',
  'signed',
  'declined',
  'dormant'
);

create table casting_candidates (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  handle_tiktok text,
  handle_instagram text,
  handle_youtube text,
  niche text,
  archetype text,
  follower_count int,
  source text,             -- 'apify' | 'referral' | 'inbound' | 'scout' | etc
  source_detail text,
  stage candidate_stage not null default 'discovered',
  owner_id uuid references workspace_users(id) on delete set null,
  notes text,
  next_touch_at timestamptz,
  signed_creator_id uuid references creators(id) on delete set null,
  evaluated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index candidates_stage_idx on casting_candidates (stage, updated_at desc);
create index candidates_owner_idx on casting_candidates (owner_id) where stage not in ('signed', 'declined', 'dormant');

-- 5. Brand deals / campaigns.
create type campaign_status as enum (
  'pitching',
  'in_negotiation',
  'booked',
  'in_production',
  'live',
  'wrapped',
  'cancelled'
);

create table brand_campaigns (
  id uuid primary key default uuid_generate_v4(),
  brand_name text not null,
  brand_contact_name text,
  brand_contact_email text,
  campaign_name text not null,
  brief text,
  budget_usd numeric(12, 2),
  start_date date,
  end_date date,
  status campaign_status not null default 'pitching',
  owner_id uuid references workspace_users(id) on delete set null,
  required_disclosure_tags text[] default array['ad', 'sponsored'],
  created_at timestamptz not null default now()
);

create index campaigns_status_idx on brand_campaigns (status, end_date);

create type assignment_status as enum (
  'proposed',
  'pitched',
  'booked',
  'in_production',
  'posted',
  'paid',
  'declined'
);

create table campaign_assignments (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references brand_campaigns(id) on delete cascade,
  creator_id uuid not null references creators(id) on delete cascade,
  deliverables jsonb not null,         -- e.g. [{kind:'reel', count:1, due:'2026-...'}]
  fee_usd numeric(12, 2),
  status assignment_status not null default 'proposed',
  posted_post_ids uuid[] default array[]::uuid[],
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (campaign_id, creator_id)
);

create index assignments_creator_idx on campaign_assignments (creator_id, status);

-- 6. Content briefs / weekly calendar.
create type brief_status as enum ('draft', 'published', 'in_progress', 'posted', 'skipped');

create table content_briefs (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  week_of date not null,                          -- Monday of the week
  campaign_assignment_id uuid references campaign_assignments(id) on delete set null,
  concept text not null,
  format text,                                    -- 'reel', 'series episode', 'pov', etc.
  due_at date,
  fulfilled_post_id uuid references posts(id) on delete set null,
  status brief_status not null default 'draft',
  created_by uuid references workspace_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index briefs_creator_week_idx on content_briefs (creator_id, week_of desc);

-- 7. Comm log. Lightweight CRM-style notes per creator.
create table comm_log (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid references creators(id) on delete cascade,
  candidate_id uuid references casting_candidates(id) on delete cascade,
  author_id uuid references workspace_users(id) on delete set null,
  channel text,                                   -- 'dm', 'email', 'call', 'in_person', 'slack'
  summary text not null,
  full_text text,
  created_at timestamptz not null default now(),
  check (creator_id is not null or candidate_id is not null)
);

create index comm_log_creator_idx on comm_log (creator_id, created_at desc);
create index comm_log_candidate_idx on comm_log (candidate_id, created_at desc);

-- 8. Compliance.
create type compliance_kind as enum (
  'missing_disclosure',
  'unclear_disclosure',
  'off_brand',
  'late_post',
  'wrong_format'
);

create type compliance_severity as enum ('info', 'warn', 'block');

create table compliance_flags (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid references posts(id) on delete cascade,
  campaign_assignment_id uuid references campaign_assignments(id) on delete cascade,
  kind compliance_kind not null,
  severity compliance_severity not null,
  detail text,
  resolved_at timestamptz,
  resolved_by uuid references workspace_users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now()
);

create index compliance_unresolved_idx on compliance_flags (created_at desc) where resolved_at is null;

-- 9. Cross-creator trend signals (internal trend desk).
create table trend_signals (
  id uuid primary key default uuid_generate_v4(),
  week_of date not null,
  signal_type text not null,                      -- 'sound', 'hashtag', 'hook_pattern'
  key text not null,                              -- the sound id, hashtag, hook label, etc.
  occurrences int not null,
  contributing_creator_ids uuid[] not null default array[]::uuid[],
  top_post_ids uuid[] not null default array[]::uuid[],
  velocity_pct numeric,                           -- vs previous week
  created_at timestamptz not null default now(),
  unique (week_of, signal_type, key)
);

create index trend_signals_week_idx on trend_signals (week_of desc, signal_type);

-- 10. Generated artifacts.
create table creator_statements (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  month_of date not null,                         -- first day of the month
  posts_count int not null,
  total_views bigint,
  total_engagement bigint,
  campaign_revenue_usd numeric(12, 2),
  agency_commission_usd numeric(12, 2),
  creator_payout_usd numeric(12, 2),
  narrative text,
  payload jsonb,                                  -- top posts, growth deltas, etc.
  total_cost_usd numeric(10, 6),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'edited')),
  model text,
  created_at timestamptz not null default now(),
  unique (creator_id, month_of)
);

create table campaign_reports (
  id uuid primary key default uuid_generate_v4(),
  campaign_id uuid not null references brand_campaigns(id) on delete cascade,
  generated_at timestamptz not null default now(),
  total_reach bigint,
  total_engagement bigint,
  total_views bigint,
  cost_per_thousand_views numeric(10, 4),
  narrative text,
  payload jsonb,                                  -- per-creator breakdown
  total_cost_usd numeric(10, 6),
  model text
);

-- 11. Compliance check log (LLM call telemetry, separate from agent_runs to avoid
-- enum churn).
create table compliance_runs (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid references posts(id) on delete cascade,
  model text not null,
  success boolean not null,
  parse_error text,
  input_tokens int,
  output_tokens int,
  cache_read_input_tokens int,
  cache_creation_input_tokens int,
  cost_usd numeric(10, 6),
  duration_ms int,
  result jsonb,
  created_at timestamptz not null default now()
);

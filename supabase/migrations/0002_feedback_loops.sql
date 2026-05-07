-- Feedback loops: refresh function, LLM-call telemetry, review approval workflow,
-- ingestion run log, and a data-freshness view. Additive over 0001.

-- 1. Materialized view refresh as a callable RPC.
create or replace function refresh_creator_baselines() returns void
language plpgsql security definer as $$
begin
  refresh materialized view concurrently creator_baselines;
end $$;

-- 2. Every LLM call logged for cost + reliability tracking.
create type agent_run_kind as enum (
  'hook_tag',
  'retention_diagnosis',
  'weekly_review',
  'monthly_review'
);

create table agent_runs (
  id uuid primary key default uuid_generate_v4(),
  kind agent_run_kind not null,
  model text not null,
  post_id uuid references posts(id) on delete set null,
  review_id uuid references reviews(id) on delete set null,
  success boolean not null,
  parse_error text,
  input_tokens int,
  output_tokens int,
  cache_read_input_tokens int,
  cache_creation_input_tokens int,
  cost_usd numeric(10, 6),
  duration_ms int,
  created_at timestamptz not null default now()
);

create index agent_runs_kind_created_idx on agent_runs (kind, created_at desc);
create index agent_runs_post_idx on agent_runs (post_id) where post_id is not null;
create index agent_runs_review_idx on agent_runs (review_id) where review_id is not null;

-- 3. Review approval workflow.
alter table reviews
  add column approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected', 'edited')),
  add column coordinator_edits jsonb,
  add column rejection_reason text,
  add column total_cost_usd numeric(10, 6);

-- 4. Per-creator-per-platform ingestion log.
create table ingestion_runs (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  platform platform not null,
  source data_source not null,
  inserted int not null default 0,
  updated int not null default 0,
  success boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index ingestion_runs_creator_platform_idx
  on ingestion_runs (creator_id, platform, created_at desc);

-- 5. Freshness view: hours since the last metric snapshot per creator.
-- Used by the health check to surface creators with stale data (>48h).
create view creator_data_freshness as
select
  c.id as creator_id,
  c.name,
  c.status,
  max(m.collected_at) as last_metric_at,
  case
    when max(m.collected_at) is null then null
    else extract(epoch from (now() - max(m.collected_at))) / 3600.0
  end as hours_since_last_metric
from creators c
left join posts p on p.creator_id = c.id
left join post_metrics m on m.post_id = p.id
where c.status = 'active'
group by c.id, c.name, c.status;

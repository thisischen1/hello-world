-- Dawn CreatorOps schema
-- Run via Supabase SQL editor or `supabase db push`

create extension if not exists "uuid-ossp";

create type platform as enum ('tiktok', 'instagram', 'youtube');
create type creator_status as enum ('active', 'paused', 'churned');
create type post_status as enum ('detected', 'analyzed', 'reviewed');
create type review_type as enum ('weekly', 'monthly');
create type alert_level as enum ('soft', 'medium', 'high');
create type series_status as enum ('active', 'paused', 'remix', 'killed');
create type data_source as enum ('display_api', 'graph_api', 'extension', 'scraper', 'manual');

create table creators (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  handle_tiktok text,
  handle_instagram text,
  handle_youtube text,
  archetype text,
  expected_posts_per_week int default 5,
  status creator_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index creators_handle_tiktok_idx on creators (handle_tiktok) where handle_tiktok is not null;
create unique index creators_handle_instagram_idx on creators (handle_instagram) where handle_instagram is not null;

create table series (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  name text not null,
  description text,
  status series_status not null default 'active',
  narrative_goal text,
  created_at timestamptz not null default now()
);

create table posts (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  series_id uuid references series(id) on delete set null,
  platform platform not null,
  platform_post_id text not null,
  url text not null,
  posted_at timestamptz not null,
  duration_seconds int,
  caption text,
  transcript text,
  audio_id text,
  hashtags text[],
  status post_status not null default 'detected',
  created_at timestamptz not null default now(),
  unique (platform, platform_post_id)
);

create index posts_creator_posted_idx on posts (creator_id, posted_at desc);

-- One row per metric snapshot. Multiple snapshots per post (24h, 72h, 7d).
create table post_metrics (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  collected_at timestamptz not null default now(),
  source data_source not null,
  views bigint,
  likes int,
  comments int,
  shares int,
  saves int,
  avg_watch_time_seconds numeric,
  completion_rate numeric,
  follower_delta int,
  profile_visits int,
  raw jsonb
);

create index post_metrics_post_idx on post_metrics (post_id, collected_at desc);

-- Per-second retention. Sourced from extension only.
create table retention_curves (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade,
  collected_at timestamptz not null default now(),
  -- array of { second: int, watching_pct: float }
  curve jsonb not null,
  unique (post_id, collected_at)
);

create table hook_analyses (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade unique,
  hook_type text not null, -- curiosity / conflict / relatable / chaos / question / pov / character / reveal / product / weak
  hook_text text,
  first_frame_note text,
  hook_label text not null, -- strong / weak / unclear
  recommended_hook text,
  model text not null,
  created_at timestamptz not null default now()
);

create table retention_diagnoses (
  id uuid primary key default uuid_generate_v4(),
  post_id uuid not null references posts(id) on delete cascade unique,
  retention_label text not null, -- strong / weak / unclear
  dropoff_second int,
  diagnosis text,
  edit_recommendation text,
  model text not null,
  created_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  review_type review_type not null,
  period_start date not null,
  period_end date not null,
  -- coordinator-facing analytical note
  coordinator_note jsonb not null,
  -- creator-facing message bullets
  creator_bullets jsonb,
  -- arrays of { hook | series | assignment } for next period
  recommendations jsonb,
  -- followup tracking: did the creator try the previous recs?
  previous_recommendations_followed jsonb,
  -- delta from prior period for learning loop
  outcome_metric_delta jsonb,
  data_completeness numeric, -- 0..1; gates how confidently we speak
  model text not null,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  unique (creator_id, review_type, period_start)
);

create index reviews_creator_period_idx on reviews (creator_id, period_start desc);

create table alerts (
  id uuid primary key default uuid_generate_v4(),
  creator_id uuid not null references creators(id) on delete cascade,
  level alert_level not null,
  reason text not null,
  payload jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index alerts_unresolved_idx on alerts (creator_id, created_at desc) where resolved_at is null;

-- Trailing 4-week median per-creator baseline, refreshed daily.
create materialized view creator_baselines as
select
  p.creator_id,
  percentile_cont(0.5) within group (order by m.views) as median_views,
  percentile_cont(0.5) within group (order by m.likes) as median_likes,
  percentile_cont(0.5) within group (order by m.comments) as median_comments,
  percentile_cont(0.5) within group (order by m.saves) as median_saves,
  percentile_cont(0.5) within group (order by m.shares) as median_shares,
  percentile_cont(0.5) within group (order by m.avg_watch_time_seconds) as median_awt,
  count(*) as sample_size
from posts p
join lateral (
  select * from post_metrics m2
  where m2.post_id = p.id
  order by m2.collected_at desc
  limit 1
) m on true
where p.posted_at > now() - interval '28 days'
group by p.creator_id;

create unique index creator_baselines_pk on creator_baselines (creator_id);

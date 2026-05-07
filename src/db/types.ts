export type Platform = 'tiktok' | 'instagram' | 'youtube';
export type CreatorStatus = 'active' | 'paused' | 'churned';
export type PostStatus = 'detected' | 'analyzed' | 'reviewed';
export type ReviewType = 'weekly' | 'monthly';
export type AlertLevel = 'soft' | 'medium' | 'high';
export type SeriesStatus = 'active' | 'paused' | 'remix' | 'killed';
export type DataSource = 'display_api' | 'graph_api' | 'extension' | 'scraper' | 'manual';

export type HookType =
  | 'curiosity'
  | 'conflict'
  | 'relatable'
  | 'chaos'
  | 'question'
  | 'pov'
  | 'character'
  | 'reveal'
  | 'product'
  | 'weak';

export type StrengthLabel = 'strong' | 'weak' | 'unclear';

export interface Creator {
  id: string;
  name: string;
  handle_tiktok: string | null;
  handle_instagram: string | null;
  handle_youtube: string | null;
  archetype: string | null;
  expected_posts_per_week: number;
  status: CreatorStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  creator_id: string;
  series_id: string | null;
  platform: Platform;
  platform_post_id: string;
  url: string;
  posted_at: string;
  duration_seconds: number | null;
  caption: string | null;
  transcript: string | null;
  audio_id: string | null;
  hashtags: string[] | null;
  status: PostStatus;
  created_at: string;
}

export interface PostMetrics {
  id: string;
  post_id: string;
  collected_at: string;
  source: DataSource;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  avg_watch_time_seconds: number | null;
  completion_rate: number | null;
  follower_delta: number | null;
  profile_visits: number | null;
  raw: unknown;
}

export interface HookAnalysis {
  id: string;
  post_id: string;
  hook_type: HookType;
  hook_text: string | null;
  first_frame_note: string | null;
  hook_label: StrengthLabel;
  recommended_hook: string | null;
  model: string;
  created_at: string;
}

export interface RetentionDiagnosis {
  id: string;
  post_id: string;
  retention_label: StrengthLabel;
  dropoff_second: number | null;
  diagnosis: string | null;
  edit_recommendation: string | null;
  model: string;
  created_at: string;
}

export interface CreatorBaseline {
  creator_id: string;
  median_views: number | null;
  median_likes: number | null;
  median_comments: number | null;
  median_saves: number | null;
  median_shares: number | null;
  median_awt: number | null;
  sample_size: number;
}

export interface CoordinatorNote {
  summary: string;
  wins: string[];
  issues: string[];
  best_post: { post_id: string; reason: string } | null;
  weakest_post: { post_id: string; reason: string } | null;
  retention_note: string | null;
  hook_pattern: string | null;
  posting_consistency: { posted: number; expected: number; verdict: string };
}

export interface CreatorBullets {
  greeting: string;
  bullets: string[];
  next_assignment: string;
}

export interface Recommendations {
  hooks: string[];
  series: string[];
  assignment: string;
}

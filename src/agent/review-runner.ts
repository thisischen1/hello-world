import { supabase } from '../lib/supabase.ts';
import { logAgentRun } from './runs.ts';
import { generateWeeklyReview, type WeeklyReviewInput } from './review.ts';
import type { CreatorBaseline, HookAnalysis, Post, PostMetrics, RetentionDiagnosis } from '../db/types.ts';
import type { Recommendations } from '../db/types.ts';

// Followthrough: did this week's posts use any hooks recommended last week?
// Substring matching is intentionally weak — better than nothing, honest about its limits.
// TODO: replace with a small LLM call once we have ground-truth examples.
function computeFollowthrough(
  prior: Recommendations | null,
  posts: Array<{ post: Post; hook: HookAnalysis | null }>,
): {
  hooks_followed: Array<{ rec: string; matched_post_id: string }>;
  hooks_not_followed: string[];
} {
  if (!prior) return { hooks_followed: [], hooks_not_followed: [] };
  const followed: Array<{ rec: string; matched_post_id: string }> = [];
  const notFollowed: string[] = [];

  for (const rec of prior.hooks ?? []) {
    const recLower = rec.toLowerCase();
    const tokens = recLower
      .split(/\W+/)
      .filter((t) => t.length >= 4);
    const match = posts.find(({ post }) => {
      const cap = (post.caption ?? '').toLowerCase();
      if (cap.includes(recLower.slice(0, Math.min(20, recLower.length)))) return true;
      const overlap = tokens.filter((t) => cap.includes(t)).length;
      return tokens.length > 0 && overlap / tokens.length >= 0.5;
    });
    if (match) followed.push({ rec, matched_post_id: match.post.id });
    else notFollowed.push(rec);
  }

  return { hooks_followed: followed, hooks_not_followed: notFollowed };
}

// Outcome delta: for each followed rec, how did the matching post perform vs creator baseline?
function computeOutcomeDelta(
  followed: Array<{ rec: string; matched_post_id: string }>,
  posts: Array<{ post: Post; metrics: PostMetrics | null }>,
  baseline: CreatorBaseline | null,
): Array<{
  rec: string;
  post_id: string;
  views_delta_pct: number | null;
  awt_delta_pct: number | null;
}> {
  if (!baseline) return [];
  return followed.map(({ rec, matched_post_id }) => {
    const m = posts.find((p) => p.post.id === matched_post_id)?.metrics;
    const viewsDelta =
      m?.views != null && baseline.median_views ? (m.views - baseline.median_views) / baseline.median_views : null;
    const awtDelta =
      m?.avg_watch_time_seconds != null && baseline.median_awt
        ? (m.avg_watch_time_seconds - baseline.median_awt) / baseline.median_awt
        : null;
    return { rec, post_id: matched_post_id, views_delta_pct: viewsDelta, awt_delta_pct: awtDelta };
  });
}

export interface RunWeeklyReviewResult {
  review_id: string | null;
  cost_usd: number;
  parse_error: string | null;
  data_completeness: number | null;
  posts_in_period: number;
}

export async function runWeeklyReviewForCreator(creatorId: string): Promise<RunWeeklyReviewResult> {
  const { data: creator, error: cErr } = await supabase
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();
  if (cErr || !creator) throw cErr ?? new Error('creator not found');

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: posts, error: pErr } = await supabase
    .from('posts')
    .select('*')
    .eq('creator_id', creatorId)
    .gte('posted_at', periodStart.toISOString())
    .order('posted_at', { ascending: true });
  if (pErr) throw pErr;

  const enriched: WeeklyReviewInput['posts'] = [];
  for (const post of posts ?? []) {
    const { data: metrics } = await supabase
      .from('post_metrics')
      .select('*')
      .eq('post_id', post.id)
      .order('collected_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: hook } = await supabase.from('hook_analyses').select('*').eq('post_id', post.id).maybeSingle();
    const { data: retention } = await supabase
      .from('retention_diagnoses')
      .select('*')
      .eq('post_id', post.id)
      .maybeSingle();
    enriched.push({ post, metrics, hook, retention });
  }

  const { data: baseline } = await supabase
    .from('creator_baselines')
    .select('*')
    .eq('creator_id', creatorId)
    .maybeSingle();

  const { data: priorReview } = await supabase
    .from('reviews')
    .select('id, recommendations')
    .eq('creator_id', creatorId)
    .eq('review_type', 'weekly')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: campaignRows } = await supabase
    .from('campaign_assignments')
    .select('deliverables, status, brand_campaigns(brand_name, campaign_name, end_date)')
    .eq('creator_id', creatorId)
    .in('status', ['booked', 'in_production', 'posted']);

  const active_campaigns = (campaignRows ?? []).map((a) => {
    const c = a.brand_campaigns as unknown as
      | { brand_name: string; campaign_name: string; end_date: string | null }
      | null;
    return {
      brand_name: c?.brand_name ?? 'unknown',
      campaign_name: c?.campaign_name ?? 'unknown',
      deliverables: a.deliverables,
      status: a.status as string,
      end_date: c?.end_date ?? null,
    };
  });

  const { data: briefRows } = await supabase
    .from('content_briefs')
    .select('week_of, concept, format, due_at')
    .eq('creator_id', creatorId)
    .gte('week_of', periodEnd.toISOString().slice(0, 10))
    .in('status', ['draft', 'published', 'in_progress'])
    .order('week_of', { ascending: true })
    .limit(5);

  const upcoming_briefs = (briefRows ?? []).map((b) => ({
    week_of: b.week_of as string,
    concept: b.concept as string,
    format: (b.format as string | null) ?? null,
    due_at: (b.due_at as string | null) ?? null,
  }));

  const result = await generateWeeklyReview({
    creator,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    posts: enriched,
    baseline,
    prior_recommendations: priorReview?.recommendations ?? null,
    active_campaigns,
    upcoming_briefs,
  });

  // Compute followthrough + outcome from prior recommendations vs this week's posts.
  const followthrough = computeFollowthrough(priorReview?.recommendations ?? null, enriched);
  const outcomeDelta = computeOutcomeDelta(followthrough.hooks_followed, enriched, baseline);

  let reviewId: string | null = null;
  if (result.review) {
    const { data: inserted, error: insertErr } = await supabase
      .from('reviews')
      .insert({
        creator_id: creatorId,
        review_type: 'weekly',
        period_start: periodStart.toISOString().slice(0, 10),
        period_end: periodEnd.toISOString().slice(0, 10),
        coordinator_note: result.review.coordinator_note,
        creator_bullets: result.review.creator_bullets,
        recommendations: result.review.recommendations,
        previous_recommendations_followed: followthrough,
        outcome_metric_delta: outcomeDelta,
        data_completeness: result.review.data_completeness,
        model: result.model,
      })
      .select('id')
      .single();
    if (insertErr) throw insertErr;
    reviewId = (inserted as { id: string }).id;
  }

  const cost_usd = await logAgentRun({
    kind: 'weekly_review',
    model: result.model,
    review_id: reviewId,
    success: result.review !== null,
    parse_error: result.parse_error,
    usage: result.usage,
    duration_ms: result.duration_ms,
  });

  if (reviewId) {
    await supabase.from('reviews').update({ total_cost_usd: cost_usd }).eq('id', reviewId);
  }

  return {
    review_id: reviewId,
    cost_usd,
    parse_error: result.parse_error,
    data_completeness: result.review?.data_completeness ?? null,
    posts_in_period: enriched.length,
  };
}

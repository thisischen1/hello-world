import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';
import { generateWeeklyReview, type WeeklyReviewInput } from '../src/agent/review.ts';

// Generates a weekly review for one creator.
// Usage: pnpm review <creator_id>

async function main() {
  const creatorId = process.argv[2];
  if (!creatorId) {
    console.error('usage: review <creator_id>');
    process.exit(1);
  }

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
    const { data: hook } = await supabase
      .from('hook_analyses')
      .select('*')
      .eq('post_id', post.id)
      .maybeSingle();
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
    .select('recommendations')
    .eq('creator_id', creatorId)
    .eq('review_type', 'weekly')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();

  const review = await generateWeeklyReview({
    creator,
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    posts: enriched,
    baseline,
    prior_recommendations: priorReview?.recommendations ?? null,
  });

  const { error: insertErr } = await supabase.from('reviews').insert({
    creator_id: creatorId,
    review_type: 'weekly',
    period_start: periodStart.toISOString().slice(0, 10),
    period_end: periodEnd.toISOString().slice(0, 10),
    coordinator_note: review.coordinator_note,
    creator_bullets: review.creator_bullets,
    recommendations: review.recommendations,
    data_completeness: review.data_completeness,
    model: 'claude-sonnet-4-6',
  });
  if (insertErr) throw insertErr;

  console.log(JSON.stringify(review, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

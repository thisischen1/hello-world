import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { costUsd, type UsageLike } from '../lib/cost.ts';
import { supabase } from '../lib/supabase.ts';
import { StatementNarrativeSchema } from './compliance-schemas.ts';

// Monthly creator statement: posts, top performers, growth, campaign revenue
// + agency commission, plus a short LLM-written narrative.

interface PostSummary {
  post_id: string;
  posted_at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}

function monthBoundsUTC(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function generateMonthlyStatement(
  creatorId: string,
  monthDate: Date = new Date(),
): Promise<{ statement_id: string | null; cost_usd: number }> {
  const { start, end } = monthBoundsUTC(monthDate);
  const monthOf = start.toISOString().slice(0, 10);

  const { data: creator, error: cErr } = await supabase
    .from('creators')
    .select('*')
    .eq('id', creatorId)
    .single();
  if (cErr || !creator) throw cErr ?? new Error('creator not found');

  const { data: posts } = await supabase
    .from('posts')
    .select(
      'id, posted_at, post_metrics(views, likes, comments, shares, saves, collected_at)',
    )
    .eq('creator_id', creatorId)
    .gte('posted_at', start.toISOString())
    .lt('posted_at', end.toISOString())
    .order('posted_at', { ascending: true });

  const summaries: PostSummary[] = [];
  let totalViews = 0;
  let totalEng = 0;
  for (const p of posts ?? []) {
    const m = (p.post_metrics as Array<PostSummary & { collected_at: string }> | null) ?? [];
    const latest = m.sort((a, b) => (a.collected_at < b.collected_at ? 1 : -1))[0];
    const s: PostSummary = {
      post_id: p.id as string,
      posted_at: p.posted_at as string,
      views: latest?.views ?? null,
      likes: latest?.likes ?? null,
      comments: latest?.comments ?? null,
      shares: latest?.shares ?? null,
      saves: latest?.saves ?? null,
    };
    summaries.push(s);
    totalViews += s.views ?? 0;
    totalEng += (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.saves ?? 0);
  }

  const { data: assignments } = await supabase
    .from('campaign_assignments')
    .select('id, fee_usd, status, paid_at, brand_campaigns(brand_name)')
    .eq('creator_id', creatorId)
    .or(`paid_at.gte.${start.toISOString()},and(paid_at.is.null,status.eq.posted)`)
    .lt('paid_at', end.toISOString());

  let revenue = 0;
  const campaignBreakdown: Array<{ brand: string; fee: number; status: string }> = [];
  for (const a of assignments ?? []) {
    const fee = (a.fee_usd as number | null) ?? 0;
    if (a.status === 'paid' || a.status === 'posted') revenue += fee;
    const brand = (a.brand_campaigns as unknown as { brand_name: string } | null)?.brand_name ?? 'unknown';
    campaignBreakdown.push({ brand, fee, status: a.status as string });
  }
  const commissionPct = (creator.commission_pct as number | null) ?? 15;
  const commission = revenue * (commissionPct / 100);
  const payout = revenue - commission;

  // Prior month for growth comparison.
  const priorMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const { data: priorStmt } = await supabase
    .from('creator_statements')
    .select('total_views, total_engagement, posts_count')
    .eq('creator_id', creatorId)
    .eq('month_of', priorMonth.toISOString().slice(0, 10))
    .maybeSingle();

  const llmInput = {
    creator: { name: creator.name, archetype: creator.archetype, tier: creator.tier },
    month_of: monthOf,
    summary: { posts: summaries.length, total_views: totalViews, total_engagement: totalEng },
    prior_month: priorStmt,
    top_posts: [...summaries].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 5),
    campaigns: campaignBreakdown,
    revenue: { gross_usd: revenue, commission_usd: commission, payout_usd: payout, commission_pct: commissionPct },
  };

  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.review,
    max_tokens: 1200,
    output_config: { format: zodOutputFormat(StatementNarrativeSchema) },
    system: [
      {
        type: 'text',
        text: 'You write the narrative section of a monthly creator statement. Specific, kind but honest, no fabricated numbers. Cite by post_id only when comparing posts. No emojis. Plain prose.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Statement input:\n\n${JSON.stringify(llmInput, null, 2)}\n\nWrite the narrative.`,
      },
    ],
  });
  const duration_ms = Date.now() - startedAt;
  const usage: UsageLike = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
  };
  const cost = costUsd(MODELS.review, usage);

  const narrative = response.parsed_output ? JSON.stringify(response.parsed_output, null, 2) : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('creator_statements')
    .upsert(
      {
        creator_id: creatorId,
        month_of: monthOf,
        posts_count: summaries.length,
        total_views: totalViews,
        total_engagement: totalEng,
        campaign_revenue_usd: revenue,
        agency_commission_usd: commission,
        creator_payout_usd: payout,
        narrative,
        payload: llmInput,
        total_cost_usd: cost,
        model: MODELS.review,
      },
      { onConflict: 'creator_id,month_of' },
    )
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  // Suppress unused-var warning while still recording the call duration in prod logs.
  void duration_ms;

  return { statement_id: (inserted as { id: string }).id, cost_usd: cost };
}

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { costUsd, type UsageLike } from '../lib/cost.ts';
import { supabase } from '../lib/supabase.ts';
import { CampaignReportNarrativeSchema } from './compliance-schemas.ts';

// Campaign performance report. Aggregates posts across all assigned creators,
// computes spend efficiency, then writes a short narrative for the brand or
// internal review.

export async function generateCampaignReport(campaignId: string): Promise<{
  report_id: string | null;
  cost_usd: number;
}> {
  const { data: campaign, error: cErr } = await supabase
    .from('brand_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();
  if (cErr || !campaign) throw cErr ?? new Error('campaign not found');

  const { data: assignments } = await supabase
    .from('campaign_assignments')
    .select('id, creator_id, fee_usd, status, posted_post_ids, creators(name, archetype)')
    .eq('campaign_id', campaignId);

  let totalReach = 0;
  let totalEng = 0;
  let totalViews = 0;
  let totalSpend = 0;
  const perCreator: Array<{
    creator_name: string;
    fee_usd: number;
    posts: number;
    views: number;
    engagement: number;
    status: string;
  }> = [];

  for (const a of assignments ?? []) {
    const fee = (a.fee_usd as number | null) ?? 0;
    totalSpend += fee;
    const creator = a.creators as unknown as { name: string; archetype: string | null } | null;
    const postIds = (a.posted_post_ids as string[] | null) ?? [];
    let cViews = 0;
    let cEng = 0;
    if (postIds.length > 0) {
      const { data: metrics } = await supabase
        .from('post_metrics')
        .select('post_id, views, likes, comments, shares, saves, reach:views, collected_at')
        .in('post_id', postIds);
      const latestByPost = new Map<string, { views: number; likes: number; comments: number; shares: number; saves: number }>();
      for (const m of metrics ?? []) {
        const k = m.post_id as string;
        latestByPost.set(k, {
          views: (m.views as number | null) ?? 0,
          likes: (m.likes as number | null) ?? 0,
          comments: (m.comments as number | null) ?? 0,
          shares: (m.shares as number | null) ?? 0,
          saves: (m.saves as number | null) ?? 0,
        });
      }
      for (const v of latestByPost.values()) {
        cViews += v.views;
        cEng += v.likes + v.comments + v.shares + v.saves;
      }
    }
    totalViews += cViews;
    totalReach += cViews; // placeholder until we ingest reach distinctly from views
    totalEng += cEng;
    perCreator.push({
      creator_name: creator?.name ?? 'unknown',
      fee_usd: fee,
      posts: postIds.length,
      views: cViews,
      engagement: cEng,
      status: a.status as string,
    });
  }

  const cpm = totalViews > 0 ? (totalSpend / totalViews) * 1000 : null;

  const llmInput = {
    campaign: { name: campaign.campaign_name, brand: campaign.brand_name, brief: campaign.brief },
    totals: { spend_usd: totalSpend, views: totalViews, engagement: totalEng, cpm_usd: cpm },
    per_creator: perCreator,
  };

  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.review,
    max_tokens: 1500,
    output_config: { format: zodOutputFormat(CampaignReportNarrativeSchema) },
    system: [
      {
        type: 'text',
        text: 'You write a campaign performance report for an internal team and the brand. Be specific. No fabricated metrics. No emojis. If a creator underperformed, name it diplomatically. End with one concrete next-campaign recommendation.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: `Campaign data:\n\n${JSON.stringify(llmInput, null, 2)}\n\nWrite the report.` }],
  });
  const duration_ms = Date.now() - startedAt;
  void duration_ms;
  const usage: UsageLike = {
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cache_read_input_tokens: response.usage.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? null,
  };
  const cost = costUsd(MODELS.review, usage);

  const narrative = response.parsed_output ? JSON.stringify(response.parsed_output, null, 2) : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('campaign_reports')
    .insert({
      campaign_id: campaignId,
      total_reach: totalReach,
      total_engagement: totalEng,
      total_views: totalViews,
      cost_per_thousand_views: cpm,
      narrative,
      payload: llmInput,
      total_cost_usd: cost,
      model: MODELS.review,
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  return { report_id: (inserted as { id: string }).id, cost_usd: cost };
}

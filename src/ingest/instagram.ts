// Instagram Graph API ingestion.
// Docs: https://developers.facebook.com/docs/instagram-platform/api-reference
//
// What we get (free, OAuth'd via creator/business account):
//   - reels list with media metadata
//   - per-reel insights: plays, reach, saves, shares, total_interactions, avg_watch_time
//   - account-level: follower demographics, online times
//
// avg_watch_time is our best official-API retention proxy.

import { supabase } from '../lib/supabase.ts';
import type { Creator, Post } from '../db/types.ts';

const IG_API = 'https://graph.facebook.com/v23.0';

interface IGMediaResponse {
  data: Array<{
    id: string;
    media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS';
    media_product_type?: string;
    permalink: string;
    timestamp: string;
    caption?: string;
    media_url?: string;
  }>;
  paging?: { cursors: { before: string; after: string }; next?: string };
}

interface IGInsightsResponse {
  data: Array<{
    name: string;
    values: Array<{ value: number }>;
  }>;
}

export async function ingestInstagramForCreator(
  creator: Creator,
  igUserId: string,
  accessToken: string,
): Promise<{ inserted: number; updated: number }> {
  if (!creator.handle_instagram) return { inserted: 0, updated: 0 };

  const mediaRes = await fetch(
    `${IG_API}/${igUserId}/media?fields=id,media_type,media_product_type,permalink,timestamp,caption&limit=25&access_token=${accessToken}`,
  );
  if (!mediaRes.ok) throw new Error(`IG API ${mediaRes.status}: ${await mediaRes.text()}`);
  const media = (await mediaRes.json()) as IGMediaResponse;

  let inserted = 0;
  let updated = 0;

  for (const m of media.data) {
    if (m.media_product_type !== 'REELS' && m.media_type !== 'VIDEO') continue;

    const { data: existing } = await supabase
      .from('posts')
      .select('id')
      .eq('platform', 'instagram')
      .eq('platform_post_id', m.id)
      .maybeSingle();

    let postId: string;
    if (existing) {
      postId = existing.id;
      updated++;
    } else {
      const { data: post, error: postErr } = await supabase
        .from('posts')
        .insert({
          creator_id: creator.id,
          platform: 'instagram',
          platform_post_id: m.id,
          url: m.permalink,
          posted_at: m.timestamp,
          caption: m.caption ?? null,
          status: 'detected',
        })
        .select('id')
        .single();
      if (postErr) throw postErr;
      postId = (post as Pick<Post, 'id'>).id;
      inserted++;
    }

    const metrics = ['plays', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time'].join(',');
    const insightsRes = await fetch(`${IG_API}/${m.id}/insights?metric=${metrics}&access_token=${accessToken}`);
    if (!insightsRes.ok) continue;
    const insights = (await insightsRes.json()) as IGInsightsResponse;
    const byName = new Map(insights.data.map((d) => [d.name, d.values[0]?.value ?? null]));

    const awtMs = byName.get('ig_reels_avg_watch_time');
    const { error: metricsErr } = await supabase.from('post_metrics').insert({
      post_id: postId,
      source: 'graph_api',
      views: byName.get('plays') ?? null,
      likes: byName.get('likes') ?? null,
      comments: byName.get('comments') ?? null,
      shares: byName.get('shares') ?? null,
      saves: byName.get('saved') ?? null,
      avg_watch_time_seconds: awtMs != null ? awtMs / 1000 : null,
      raw: { ...m, insights: insights.data },
    });
    if (metricsErr) throw metricsErr;
  }

  return { inserted, updated };
}

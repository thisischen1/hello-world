// TikTok Display API ingestion.
// Docs: https://developers.tiktok.com/doc/login-kit-overview
//
// What we get from official API (free, OAuth'd):
//   - post list with public metrics: views, likes, comments, shares
//   - post metadata: timestamp, duration, caption, hashtags, sound id
//   - video file URL for download
//
// What we DON'T get here (extension territory):
//   - per-second retention curves
//   - completion rate
//   - audience demographics
//   - traffic source breakdown (FYP %, profile %, etc.)

import { supabase } from '../lib/supabase.ts';
import type { Creator, Post } from '../db/types.ts';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

interface TikTokVideoListResponse {
  data: {
    videos: Array<{
      id: string;
      create_time: number;
      duration: number;
      title?: string;
      video_description?: string;
      share_url: string;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
      music_id?: string;
      hashtag_names?: string[];
    }>;
    cursor?: number;
    has_more?: boolean;
  };
  error: { code: string; message: string };
}

export async function ingestTikTokForCreator(
  creator: Creator,
  accessToken: string,
): Promise<{ inserted: number; updated: number }> {
  if (!creator.handle_tiktok) return { inserted: 0, updated: 0 };

  const fields = [
    'id',
    'create_time',
    'duration',
    'title',
    'video_description',
    'share_url',
    'view_count',
    'like_count',
    'comment_count',
    'share_count',
    'music_id',
    'hashtag_names',
  ].join(',');

  const res = await fetch(`${TIKTOK_API}/video/list/?fields=${fields}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ max_count: 20 }),
  });
  if (!res.ok) {
    throw new Error(`TikTok API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as TikTokVideoListResponse;
  if (json.error?.code && json.error.code !== 'ok') {
    throw new Error(`TikTok API error: ${json.error.code} ${json.error.message}`);
  }

  let inserted = 0;
  let updated = 0;

  for (const v of json.data.videos) {
    const { data: existing } = await supabase
      .from('posts')
      .select('id')
      .eq('platform', 'tiktok')
      .eq('platform_post_id', v.id)
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
          platform: 'tiktok',
          platform_post_id: v.id,
          url: v.share_url,
          posted_at: new Date(v.create_time * 1000).toISOString(),
          duration_seconds: v.duration,
          caption: v.video_description ?? v.title ?? null,
          audio_id: v.music_id ?? null,
          hashtags: v.hashtag_names ?? null,
          status: 'detected',
        })
        .select('id')
        .single();
      if (postErr) throw postErr;
      postId = (post as Pick<Post, 'id'>).id;
      inserted++;
    }

    const { error: metricsErr } = await supabase.from('post_metrics').insert({
      post_id: postId,
      source: 'display_api',
      views: v.view_count ?? null,
      likes: v.like_count ?? null,
      comments: v.comment_count ?? null,
      shares: v.share_count ?? null,
      raw: v,
    });
    if (metricsErr) throw metricsErr;
  }

  return { inserted, updated };
}

import 'dotenv/config';
import { supabase } from '../src/lib/supabase.ts';

// Seeds one creator with a week of mock posts so the weekly review path can be exercised
// without any real platform integrations.

async function main() {
  const { data: creator, error: creatorErr } = await supabase
    .from('creators')
    .insert({
      name: 'Demo Creator',
      handle_tiktok: 'demo_creator',
      handle_instagram: 'demo_creator',
      archetype: 'chaotic friend group',
      expected_posts_per_week: 5,
    })
    .select()
    .single();
  if (creatorErr) throw creatorErr;
  console.log('Created creator:', creator.id);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const fixtures = [
    { platform: 'tiktok' as const, hook: 'POV: when your roommate eats your leftovers', views: 84000, awt: 12.4 },
    { platform: 'tiktok' as const, hook: 'we have to talk about what happened last night', views: 142000, awt: 14.1 },
    { platform: 'instagram' as const, hook: 'rating my friends on how they apologize', views: 21000, awt: 9.2 },
    { platform: 'tiktok' as const, hook: "i wasn't supposed to film this", views: 310000, awt: 17.8 },
    { platform: 'instagram' as const, hook: 'every group chat ever', views: 18000, awt: 7.5 },
  ];

  for (let i = 0; i < fixtures.length; i++) {
    const f = fixtures[i]!;
    const posted_at = new Date(now - (fixtures.length - i) * day).toISOString();
    const { data: post, error: postErr } = await supabase
      .from('posts')
      .insert({
        creator_id: creator.id,
        platform: f.platform,
        platform_post_id: `mock_${i}_${Date.now()}`,
        url: `https://${f.platform}.example/${i}`,
        posted_at,
        duration_seconds: 28,
        caption: f.hook,
        hashtags: ['fyp', 'roommates'],
        status: 'detected',
      })
      .select()
      .single();
    if (postErr) throw postErr;

    const { error: metricsErr } = await supabase.from('post_metrics').insert({
      post_id: post.id,
      source: 'manual',
      views: f.views,
      likes: Math.round(f.views * 0.08),
      comments: Math.round(f.views * 0.005),
      shares: Math.round(f.views * 0.012),
      saves: Math.round(f.views * 0.018),
      avg_watch_time_seconds: f.awt,
      completion_rate: f.awt / 28,
    });
    if (metricsErr) throw metricsErr;
  }

  console.log(`Seeded ${fixtures.length} posts for ${creator.name}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

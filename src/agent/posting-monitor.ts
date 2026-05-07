import { supabase } from '../lib/supabase.ts';
import { slackAlert } from '../lib/slack.ts';

// Compares posts-this-week vs. expected_posts_per_week per active creator.
// Writes alerts at the level appropriate for how much they're under, deduped over 24h.

export async function runPostingMonitor(): Promise<{
  alerted: number;
  ok: number;
}> {
  const { data: creators, error } = await supabase
    .from('creators')
    .select('id, name, expected_posts_per_week')
    .eq('status', 'active');
  if (error) throw error;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dedupeSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let alerted = 0;
  let ok = 0;

  for (const c of creators ?? []) {
    const { count } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', c.id)
      .gte('posted_at', since);

    const posted = count ?? 0;
    const expected = c.expected_posts_per_week ?? 5;
    const missed = expected - posted;

    if (missed <= 0) {
      ok++;
      continue;
    }

    const level = missed >= 3 ? 'high' : missed >= 2 ? 'medium' : 'soft';
    const reason = `${c.name}: posted ${posted}/${expected} this week (${missed} short)`;

    const { data: existing } = await supabase
      .from('alerts')
      .select('id')
      .eq('creator_id', c.id)
      .gte('created_at', dedupeSince)
      .like('reason', `${c.name}: posted%`)
      .maybeSingle();

    if (existing) continue;

    await supabase.from('alerts').insert({
      creator_id: c.id,
      level,
      reason,
      payload: { posted, expected, missed },
    });
    alerted++;

    if (level === 'high') {
      await slackAlert(`HIGH: ${reason}`, 'error');
    } else if (level === 'medium') {
      await slackAlert(`MEDIUM: ${reason}`, 'warn');
    }
  }

  return { alerted, ok };
}

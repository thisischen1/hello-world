import { supabase } from '../lib/supabase.ts';
import { slackAlert } from '../lib/slack.ts';

// Per-coordinator daily digest. Pulls everything that happened in their roster
// over the last 24h and Slacks a summary. No LLM — pure data, just formatted.

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runCoordinatorDigest(): Promise<{ digests_sent: number }> {
  const since = new Date(Date.now() - DAY_MS).toISOString();

  const { data: coordinators, error } = await supabase
    .from('workspace_users')
    .select('id, name, slack_user_id')
    .eq('role', 'coordinator')
    .eq('active', true);
  if (error) throw error;

  let digests = 0;

  for (const u of coordinators ?? []) {
    const { data: roster } = await supabase
      .from('creators')
      .select('id, name, expected_posts_per_week')
      .eq('assigned_coordinator_id', u.id)
      .eq('status', 'active');

    if (!roster || roster.length === 0) continue;
    const creatorIds = roster.map((c) => c.id);

    const [
      { data: newPosts },
      { data: openAlerts },
      { data: complianceFlags },
      { data: unfollowedBriefs },
    ] = await Promise.all([
      supabase
        .from('posts')
        .select('id, creator_id, posted_at, url')
        .in('creator_id', creatorIds)
        .gte('posted_at', since),
      supabase
        .from('alerts')
        .select('id, creator_id, level, reason')
        .in('creator_id', creatorIds)
        .is('resolved_at', null),
      supabase
        .from('compliance_flags')
        .select('id, post_id, kind, severity, detail, posts(creator_id)')
        .is('resolved_at', null)
        .gte('created_at', since),
      supabase
        .from('content_briefs')
        .select('id, creator_id, concept, due_at')
        .in('creator_id', creatorIds)
        .lte('due_at', new Date(Date.now() + 2 * DAY_MS).toISOString().slice(0, 10))
        .in('status', ['draft', 'published', 'in_progress']),
    ]);

    const flagsForRoster =
      (complianceFlags ?? []).filter((f) => {
        const c = (f.posts as unknown as { creator_id: string } | null)?.creator_id;
        return c ? creatorIds.includes(c) : false;
      }) ?? [];

    const lines: string[] = [];
    lines.push(`*Daily digest — ${u.name}*`);
    lines.push(`Roster: ${roster.length} creators`);
    lines.push(`New posts (24h): ${newPosts?.length ?? 0}`);
    lines.push(`Open alerts: ${openAlerts?.length ?? 0}`);
    if ((openAlerts?.length ?? 0) > 0) {
      for (const a of openAlerts ?? []) {
        const c = roster.find((r) => r.id === a.creator_id);
        lines.push(`  - [${a.level}] ${c?.name ?? '?'}: ${a.reason}`);
      }
    }
    lines.push(`New compliance flags (24h): ${flagsForRoster.length}`);
    for (const f of flagsForRoster) {
      lines.push(`  - [${f.severity}] ${f.kind}: ${f.detail}`);
    }
    lines.push(`Briefs due in next 48h: ${unfollowedBriefs?.length ?? 0}`);
    for (const b of unfollowedBriefs ?? []) {
      const c = roster.find((r) => r.id === b.creator_id);
      lines.push(`  - ${c?.name ?? '?'} (${b.due_at}): ${b.concept}`);
    }

    await slackAlert(lines.join('\n'), 'info');
    digests++;
  }

  return { digests_sent: digests };
}

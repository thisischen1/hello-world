import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { supabase } from '../lib/supabase.ts';
import { TrendSummarySchema } from './compliance-schemas.ts';
import { logAgentRun } from './runs.ts';
import type { UsageLike } from '../lib/cost.ts';

// Pure-SQL aggregation across the network: which sounds, hashtags, and hook
// patterns are showing up most this week, with velocity vs. last week.
//
// LLM is used only to write a short coordinator-facing summary at the end.

interface RawSignal {
  signal_type: 'sound' | 'hashtag' | 'hook_pattern';
  key: string;
  occurrences: number;
  contributing_creator_ids: string[];
  top_post_ids: string[];
}

function startOfIsoWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getUTCDay();
  const diff = (day + 6) % 7; // Mon = 0
  out.setUTCDate(out.getUTCDate() - diff);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

async function aggregateSignals(weekOf: Date): Promise<RawSignal[]> {
  const start = weekOf.toISOString();
  const end = new Date(weekOf.getTime() + 7 * 24 * 3600_000).toISOString();

  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, creator_id, audio_id, hashtags, hook_analyses(hook_type)')
    .gte('posted_at', start)
    .lt('posted_at', end);
  if (error) throw error;

  const byKey = new Map<string, RawSignal>();
  function bump(type: RawSignal['signal_type'], key: string, postId: string, creatorId: string) {
    const k = `${type}:${key}`;
    let row = byKey.get(k);
    if (!row) {
      row = { signal_type: type, key, occurrences: 0, contributing_creator_ids: [], top_post_ids: [] };
      byKey.set(k, row);
    }
    row.occurrences++;
    if (!row.contributing_creator_ids.includes(creatorId)) row.contributing_creator_ids.push(creatorId);
    if (row.top_post_ids.length < 5) row.top_post_ids.push(postId);
  }

  for (const p of posts ?? []) {
    if (p.audio_id) bump('sound', p.audio_id as string, p.id as string, p.creator_id as string);
    for (const h of (p.hashtags as string[] | null) ?? []) {
      bump('hashtag', h.toLowerCase(), p.id as string, p.creator_id as string);
    }
    const ha = p.hook_analyses as { hook_type?: string } | { hook_type?: string }[] | null;
    const hookType = Array.isArray(ha) ? ha[0]?.hook_type : ha?.hook_type;
    if (hookType) bump('hook_pattern', hookType, p.id as string, p.creator_id as string);
  }

  // Cross-creator only: filter signals where at least 2 creators used the key.
  return Array.from(byKey.values()).filter((s) => s.contributing_creator_ids.length >= 2);
}

export async function runTrendDesk(): Promise<{
  signals: number;
  summary: string | null;
  cost_usd: number;
}> {
  const weekOf = startOfIsoWeek(new Date());
  const lastWeek = new Date(weekOf.getTime() - 7 * 24 * 3600_000);

  const [thisWeek, prior] = await Promise.all([aggregateSignals(weekOf), aggregateSignals(lastWeek)]);
  const priorByKey = new Map(prior.map((s) => [`${s.signal_type}:${s.key}`, s.occurrences]));

  // Upsert signals for this week with velocity %.
  for (const s of thisWeek) {
    const priorCount = priorByKey.get(`${s.signal_type}:${s.key}`) ?? 0;
    const velocity = priorCount > 0 ? (s.occurrences - priorCount) / priorCount : null;
    await supabase.from('trend_signals').upsert(
      {
        week_of: weekOf.toISOString().slice(0, 10),
        signal_type: s.signal_type,
        key: s.key,
        occurrences: s.occurrences,
        contributing_creator_ids: s.contributing_creator_ids,
        top_post_ids: s.top_post_ids,
        velocity_pct: velocity,
      },
      { onConflict: 'week_of,signal_type,key' },
    );
  }

  // Build the LLM input: top 10 of each type by occurrence + velocity.
  const topByType = (type: RawSignal['signal_type']) =>
    thisWeek
      .filter((s) => s.signal_type === type)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10);

  const sounds = topByType('sound');
  const hashtags = topByType('hashtag');
  const patterns = topByType('hook_pattern');

  if (sounds.length === 0 && hashtags.length === 0 && patterns.length === 0) {
    return { signals: thisWeek.length, summary: null, cost_usd: 0 };
  }

  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.review,
    max_tokens: 1500,
    output_config: { format: zodOutputFormat(TrendSummarySchema) },
    system: [
      {
        type: 'text',
        text: 'You write a weekly trend summary for an internal coordinator team at a creator agency. Be specific. No generic advice. If nothing is notable, say so by leaving fields empty.',
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Cross-creator trend data (week of ${weekOf.toISOString().slice(0, 10)}):\n\n${JSON.stringify({ sounds, hashtags, patterns }, null, 2)}\n\nProduce the summary.`,
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
  const cost_usd = await logAgentRun({
    kind: 'weekly_review',
    model: MODELS.review,
    success: response.parsed_output !== null,
    parse_error: response.parsed_output ? null : `stop_reason=${response.stop_reason}`,
    usage,
    duration_ms,
  });

  const summary = response.parsed_output ? JSON.stringify(response.parsed_output, null, 2) : null;
  return { signals: thisWeek.length, summary, cost_usd };
}

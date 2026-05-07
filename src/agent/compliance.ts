import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { costUsd, type UsageLike } from '../lib/cost.ts';
import { supabase } from '../lib/supabase.ts';
import { slackAlert } from '../lib/slack.ts';
import { DisclosureCheckSchema, type DisclosureCheck } from './compliance-schemas.ts';

const SYSTEM = `You audit short-form video captions for FTC sponsorship disclosure.

Rules:
- "present" only when disclosure is clear and unambiguous (e.g. #ad, #sponsored, "paid partnership with X", "thanks to @brand for sponsoring").
- "missing" when there is no disclosure language at all.
- "unclear" when there is ambiguous language ("partnered with", "thanks to") that may not satisfy FTC guidance, or when disclosure is buried at the end of a long caption.
- Branded mentions of the product without disclosure language = missing.
- Hashtags must include #ad, #sponsored, #partner, #paidpartnership or platform-native disclosure tags to count.

Be strict. Erring toward "unclear" or "missing" is correct — coordinators will resolve.`;

interface CheckInput {
  post_id: string;
  caption: string | null;
  brand_name: string;
  required_tags: string[];
}

interface CheckResult {
  result: DisclosureCheck | null;
  model: string;
  usage: UsageLike;
  parse_error: string | null;
  duration_ms: number;
}

async function callDisclosureCheck(input: CheckInput): Promise<CheckResult> {
  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.tag,
    max_tokens: 512,
    output_config: { format: zodOutputFormat(DisclosureCheckSchema) },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Post (sponsored by ${input.brand_name}; required tags: ${input.required_tags.join(', ')}):\n\nCaption:\n${input.caption ?? '(no caption)'}\n\nReturn the disclosure check.`,
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
  return {
    result: response.parsed_output ?? null,
    model: MODELS.tag,
    usage,
    parse_error: response.parsed_output ? null : `stop_reason=${response.stop_reason}`,
    duration_ms,
  };
}

// Walk recently-posted sponsored posts, run disclosure checks, write
// compliance_flags for anything missing or unclear, Slack any "missing".
export async function runComplianceChecks(): Promise<{ checked: number; flagged: number }> {
  // Find posts that have a fulfilled brief tied to a campaign assignment, and
  // we haven't already checked.
  const { data: candidates, error } = await supabase
    .from('content_briefs')
    .select(
      'id, fulfilled_post_id, campaign_assignment_id, posts:fulfilled_post_id(id, caption, posted_at), assignment:campaign_assignment_id(campaign_id, brand_campaigns(brand_name, required_disclosure_tags))',
    )
    .not('fulfilled_post_id', 'is', null)
    .not('campaign_assignment_id', 'is', null)
    .limit(100);
  if (error) throw error;

  let checked = 0;
  let flagged = 0;

  for (const row of candidates ?? []) {
    const post = row.posts as unknown as { id: string; caption: string | null } | null;
    const assignment = row.assignment as unknown as
      | { campaign_id: string; brand_campaigns: { brand_name: string; required_disclosure_tags: string[] } | null }
      | null;
    if (!post || !assignment?.brand_campaigns) continue;

    // Skip if already checked
    const { data: existing } = await supabase
      .from('compliance_runs')
      .select('id')
      .eq('post_id', post.id)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const r = await callDisclosureCheck({
      post_id: post.id,
      caption: post.caption,
      brand_name: assignment.brand_campaigns.brand_name,
      required_tags: assignment.brand_campaigns.required_disclosure_tags ?? [],
    });

    const cost = r.usage ? costUsd(r.model, r.usage) : 0;
    await supabase.from('compliance_runs').insert({
      post_id: post.id,
      model: r.model,
      success: r.result !== null,
      parse_error: r.parse_error,
      input_tokens: r.usage.input_tokens,
      output_tokens: r.usage.output_tokens,
      cache_read_input_tokens: r.usage.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: r.usage.cache_creation_input_tokens ?? null,
      cost_usd: cost,
      duration_ms: r.duration_ms,
      result: r.result ?? null,
    });
    checked++;

    if (!r.result) continue;
    if (r.result.status === 'present') continue;

    const kind = r.result.status === 'missing' ? 'missing_disclosure' : 'unclear_disclosure';
    const severity = r.result.status === 'missing' ? 'block' : 'warn';
    await supabase.from('compliance_flags').insert({
      post_id: post.id,
      campaign_assignment_id: row.campaign_assignment_id,
      kind,
      severity,
      detail: r.result.detail,
    });
    flagged++;

    if (severity === 'block') {
      await slackAlert(
        `BLOCK: ${assignment.brand_campaigns.brand_name} sponsored post ${post.id} is missing disclosure. ${r.result.detail}`,
        'error',
      );
    }
  }

  return { checked, flagged };
}

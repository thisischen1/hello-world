import { supabase } from '../lib/supabase.ts';
import { costUsd, type UsageLike } from '../lib/cost.ts';

export type AgentRunKind = 'hook_tag' | 'retention_diagnosis' | 'weekly_review' | 'monthly_review';

export interface AgentRunLog {
  kind: AgentRunKind;
  model: string;
  post_id?: string | null;
  review_id?: string | null;
  success: boolean;
  parse_error?: string | null;
  usage: UsageLike | null;
  duration_ms: number;
}

export async function logAgentRun(log: AgentRunLog): Promise<number> {
  const cost = log.usage ? costUsd(log.model, log.usage) : 0;
  const { error } = await supabase.from('agent_runs').insert({
    kind: log.kind,
    model: log.model,
    post_id: log.post_id ?? null,
    review_id: log.review_id ?? null,
    success: log.success,
    parse_error: log.parse_error ?? null,
    input_tokens: log.usage?.input_tokens ?? null,
    output_tokens: log.usage?.output_tokens ?? null,
    cache_read_input_tokens: log.usage?.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: log.usage?.cache_creation_input_tokens ?? null,
    cost_usd: cost,
    duration_ms: log.duration_ms,
  });
  if (error) console.error('agent_runs insert failed:', error.message);
  return cost;
}

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import type { UsageLike } from '../lib/cost.ts';
import { HOOK_TAGGER_SYSTEM, RETENTION_DIAGNOSIS_SYSTEM } from './prompts.ts';
import {
  HookAnalysisSchema,
  RetentionDiagnosisSchema,
  type HookAnalysis,
  type RetentionDiagnosis,
} from './schemas.ts';
import type { Post, PostMetrics } from '../db/types.ts';

export interface HookResult {
  hook: HookAnalysis | null;
  model: string;
  usage: UsageLike;
  parse_error: string | null;
  duration_ms: number;
}

export interface RetentionResult {
  retention: RetentionDiagnosis | null;
  model: string;
  usage: UsageLike;
  parse_error: string | null;
  duration_ms: number;
}

export interface HookTagInput {
  post: Post;
  recent_hook_history: Array<{ post_id: string; hook_type: string; hook_label: string }>;
}

export async function tagHook(input: HookTagInput): Promise<HookResult> {
  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.tag,
    max_tokens: 1024,
    output_config: { format: zodOutputFormat(HookAnalysisSchema) },
    system: [{ type: 'text', text: HOOK_TAGGER_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Post to tag (JSON):\n\n${JSON.stringify(input, null, 2)}\n\nReturn the hook analysis.`,
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
    hook: response.parsed_output ?? null,
    model: MODELS.tag,
    usage,
    parse_error: response.parsed_output ? null : `stop_reason=${response.stop_reason}`,
    duration_ms,
  };
}

export interface RetentionInput {
  post: Post;
  metrics: PostMetrics | null;
  retention_curve: Array<{ second: number; watching_pct: number }> | null;
  creator_baseline: { median_awt: number | null; median_views: number | null } | null;
}

export async function diagnoseRetention(input: RetentionInput): Promise<RetentionResult> {
  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: MODELS.tag,
    max_tokens: 1024,
    output_config: { format: zodOutputFormat(RetentionDiagnosisSchema) },
    system: [
      { type: 'text', text: RETENTION_DIAGNOSIS_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Retention input (JSON):\n\n${JSON.stringify(input, null, 2)}\n\nReturn the diagnosis.`,
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
    retention: response.parsed_output ?? null,
    model: MODELS.tag,
    usage,
    parse_error: response.parsed_output ? null : `stop_reason=${response.stop_reason}`,
    duration_ms,
  };
}

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { HOOK_TAGGER_SYSTEM, RETENTION_DIAGNOSIS_SYSTEM } from './prompts.ts';
import {
  HookAnalysisSchema,
  RetentionDiagnosisSchema,
  type HookAnalysis,
  type RetentionDiagnosis,
} from './schemas.ts';
import type { Post, PostMetrics } from '../db/types.ts';

export interface HookTagInput {
  post: Post;
  recent_hook_history: Array<{ post_id: string; hook_type: string; hook_label: string }>;
}

export async function tagHook(input: HookTagInput): Promise<HookAnalysis> {
  const response = await anthropic.messages.parse({
    model: MODELS.tag,
    max_tokens: 1024,
    output_config: { format: zodOutputFormat(HookAnalysisSchema) },
    system: [
      { type: 'text', text: HOOK_TAGGER_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Post to tag (JSON):\n\n${JSON.stringify(input, null, 2)}\n\nReturn the hook analysis.`,
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error(`Hook tagging failed to parse. stop_reason=${response.stop_reason}`);
  }
  return response.parsed_output;
}

export interface RetentionInput {
  post: Post;
  metrics: PostMetrics | null;
  retention_curve: Array<{ second: number; watching_pct: number }> | null;
  creator_baseline: { median_awt: number | null; median_views: number | null } | null;
}

export async function diagnoseRetention(input: RetentionInput): Promise<RetentionDiagnosis> {
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

  if (!response.parsed_output) {
    throw new Error(`Retention diagnosis failed to parse. stop_reason=${response.stop_reason}`);
  }
  return response.parsed_output;
}

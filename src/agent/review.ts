import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import { WEEKLY_REVIEW_SYSTEM } from './prompts.ts';
import { WeeklyReviewSchema, type WeeklyReview } from './schemas.ts';
import type { Creator, CreatorBaseline, HookAnalysis, Post, PostMetrics, RetentionDiagnosis } from '../db/types.ts';

export interface WeeklyReviewInput {
  creator: Creator;
  period_start: string;
  period_end: string;
  posts: Array<{
    post: Post;
    metrics: PostMetrics | null;
    hook: HookAnalysis | null;
    retention: RetentionDiagnosis | null;
  }>;
  baseline: CreatorBaseline | null;
  prior_recommendations: { hooks: string[]; series: string[]; assignment: string } | null;
}

export async function generateWeeklyReview(input: WeeklyReviewInput): Promise<WeeklyReview> {
  const userPayload = JSON.stringify(input, null, 2);

  const response = await anthropic.messages.parse({
    model: MODELS.review,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(WeeklyReviewSchema) },
    system: [
      {
        type: 'text',
        text: WEEKLY_REVIEW_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Creator review input (JSON):\n\n${userPayload}\n\nProduce the weekly review now.`,
      },
    ],
  });

  if (!response.parsed_output) {
    throw new Error(
      `Weekly review failed to parse. stop_reason=${response.stop_reason}, content=${JSON.stringify(response.content).slice(0, 500)}`,
    );
  }

  return response.parsed_output;
}

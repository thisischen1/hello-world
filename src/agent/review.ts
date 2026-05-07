import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropic, MODELS } from '../lib/anthropic.ts';
import type { UsageLike } from '../lib/cost.ts';
import { WEEKLY_REVIEW_SYSTEM } from './prompts.ts';
import { WeeklyReviewSchema, type WeeklyReview } from './schemas.ts';
import type {
  Creator,
  CreatorBaseline,
  HookAnalysis,
  Post,
  PostMetrics,
  RetentionDiagnosis,
} from '../db/types.ts';

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

export interface WeeklyReviewResult {
  review: WeeklyReview | null;
  model: string;
  usage: UsageLike;
  parse_error: string | null;
  duration_ms: number;
}

export async function generateWeeklyReview(input: WeeklyReviewInput): Promise<WeeklyReviewResult> {
  const startedAt = Date.now();
  const userPayload = JSON.stringify(input, null, 2);

  const response = await anthropic.messages.parse({
    model: MODELS.review,
    max_tokens: 4096,
    output_config: { format: zodOutputFormat(WeeklyReviewSchema) },
    system: [
      { type: 'text', text: WEEKLY_REVIEW_SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: `Creator review input (JSON):\n\n${userPayload}\n\nProduce the weekly review now.`,
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

  if (!response.parsed_output) {
    return {
      review: null,
      model: MODELS.review,
      usage,
      parse_error: `stop_reason=${response.stop_reason}`,
      duration_ms,
    };
  }

  return {
    review: response.parsed_output,
    model: MODELS.review,
    usage,
    parse_error: null,
    duration_ms,
  };
}

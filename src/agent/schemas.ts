import { z } from 'zod';

const StrengthLabel = z.enum(['strong', 'weak', 'unclear']);
const HookType = z.enum([
  'curiosity',
  'conflict',
  'relatable',
  'chaos',
  'question',
  'pov',
  'character',
  'reveal',
  'product',
  'weak',
]);

export const HookAnalysisSchema = z.object({
  hook_type: HookType,
  hook_text: z.string().describe('Verbatim opening words/text overlay if available; else empty.'),
  first_frame_note: z.string().describe('1 sentence on what the first frame does.'),
  hook_label: StrengthLabel.describe('Strong / weak / unclear given creator history.'),
  recommended_hook: z
    .string()
    .describe('One concrete alternate hook tailored to this creator. Empty if hook is already strong.'),
});
export type HookAnalysis = z.infer<typeof HookAnalysisSchema>;

export const RetentionDiagnosisSchema = z.object({
  retention_label: StrengthLabel,
  dropoff_second: z
    .number()
    .int()
    .nullable()
    .describe('Approximate second where attention drops most, or null if data insufficient.'),
  diagnosis: z.string().describe('1-2 sentences naming the cause. Specific, not generic.'),
  edit_recommendation: z.string().describe('One concrete edit. Empty if retention is strong.'),
});
export type RetentionDiagnosis = z.infer<typeof RetentionDiagnosisSchema>;

export const WeeklyReviewSchema = z.object({
  coordinator_note: z.object({
    summary: z.string().describe('2-3 sentences. Direct. What happened this week.'),
    wins: z.array(z.string()).max(3),
    issues: z.array(z.string()).max(3),
    best_post: z
      .object({ post_id: z.string(), reason: z.string() })
      .nullable(),
    weakest_post: z
      .object({ post_id: z.string(), reason: z.string() })
      .nullable(),
    retention_note: z.string().nullable(),
    hook_pattern: z.string().nullable().describe('Recurring hook pattern observed, if any.'),
    posting_consistency: z.object({
      posted: z.number().int(),
      expected: z.number().int(),
      verdict: z.string(),
    }),
  }),
  creator_bullets: z
    .object({
      greeting: z.string(),
      bullets: z.array(z.string()).max(5),
      next_assignment: z.string(),
    })
    .nullable()
    .describe('Encouraging, action-oriented. Null if data is too thin to message creator.'),
  recommendations: z.object({
    hooks: z.array(z.string()).max(3),
    series: z.array(z.string()).max(2),
    assignment: z.string(),
  }),
  data_completeness: z
    .number()
    .min(0)
    .max(1)
    .describe('0..1. <0.5 means avoid strong claims; <0.3 means hold the creator-facing message.'),
});
export type WeeklyReview = z.infer<typeof WeeklyReviewSchema>;

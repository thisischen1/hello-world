import { z } from 'zod';

export const DisclosureCheckSchema = z.object({
  status: z
    .enum(['present', 'missing', 'unclear'])
    .describe('present = clearly disclosed; missing = no disclosure; unclear = ambiguous wording'),
  found_tags: z
    .array(z.string())
    .describe('Disclosure markers found in the caption (e.g. #ad, "paid partnership"). Empty if none.'),
  detail: z.string().describe('1 sentence on what is or is not present.'),
});
export type DisclosureCheck = z.infer<typeof DisclosureCheckSchema>;

export const TrendSummarySchema = z.object({
  headline: z.string().describe('1 sentence: what is happening across the network this week.'),
  sounds: z.array(z.object({ key: z.string(), note: z.string() })).max(3),
  hashtags: z.array(z.object({ key: z.string(), note: z.string() })).max(3),
  hook_patterns: z.array(z.object({ pattern: z.string(), note: z.string() })).max(3),
  recommended_action: z
    .string()
    .describe('One concrete action coordinators should take this week. Empty if nothing notable.'),
});
export type TrendSummary = z.infer<typeof TrendSummarySchema>;

export const StatementNarrativeSchema = z.object({
  headline: z.string().describe('1 sentence summarizing the month for this creator.'),
  highlights: z.array(z.string()).max(4),
  growth_note: z.string().describe('Plain-language description of growth or decline. No fabricated numbers.'),
  next_month_focus: z.string(),
});
export type StatementNarrative = z.infer<typeof StatementNarrativeSchema>;

export const CampaignReportNarrativeSchema = z.object({
  headline: z.string(),
  what_worked: z.array(z.string()).max(3),
  what_didnt: z.array(z.string()).max(3),
  per_creator_notes: z.array(
    z.object({ creator_name: z.string(), note: z.string() }),
  ),
  recommendation_for_next_campaign: z.string(),
});
export type CampaignReportNarrative = z.infer<typeof CampaignReportNarrativeSchema>;

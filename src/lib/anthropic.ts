import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env['ANTHROPIC_API_KEY'];
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY must be set');
}

export const anthropic = new Anthropic({ apiKey });

export const MODELS = {
  // Cheap classification: hook tagging, retention diagnosis (per-post, high volume)
  tag: 'claude-haiku-4-5',
  // Reasoning: weekly + monthly reviews (per-creator-per-week, low volume)
  review: 'claude-sonnet-4-6',
} as const;

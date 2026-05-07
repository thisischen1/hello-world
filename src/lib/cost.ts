// Anthropic per-token pricing. Cache writes are 1.25x input; cache reads are 0.1x input.
// Numbers from the cached pricing in the claude-api skill (USD per 1M tokens).

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

const PRICING_PER_M: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function costUsd(model: string, usage: UsageLike): number {
  const p = PRICING_PER_M[model];
  if (!p) return 0;
  const m = 1_000_000;
  const input = (usage.input_tokens ?? 0) * p.input / m;
  const output = (usage.output_tokens ?? 0) * p.output / m;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) * (p.input * 0.1) / m;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) * (p.input * 1.25) / m;
  return input + output + cacheRead + cacheWrite;
}

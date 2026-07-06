// Per-MTok sticker pricing for the `api` backend (the cli backend reports
// `total_cost_usd` itself). Cache write = 1.25 × input, cache read = 0.1 ×
// input. Unknown model → cost 0 with priced:false (never throw).
interface ModelPrice {
  input: number; // $/MTok
  output: number; // $/MTok
}

const PRICING: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
};

export interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export function priceUsage(
  model: string,
  u: UsageTokens,
): { costUSD: number; priced: boolean } {
  const p = PRICING[model];
  if (!p) return { costUSD: 0, priced: false };
  const inRate = p.input / 1_000_000;
  const outRate = p.output / 1_000_000;
  const costUSD =
    u.inputTokens * inRate +
    u.outputTokens * outRate +
    u.cacheCreationTokens * inRate * 1.25 +
    u.cacheReadTokens * inRate * 0.1;
  return { costUSD, priced: true };
}

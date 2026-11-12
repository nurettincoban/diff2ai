import type { EvalConfig, Price, Usage } from './types.js';

export function priceFor(config: EvalConfig, model: string): Price {
  const price = config.pricingUsdPerMTok[model];
  if (!price) {
    throw new Error(
      `No price for model "${model}" in the eval config (pricingUsdPerMTok). Add it before running.`,
    );
  }
  return price;
}

export function costUsd(
  usage: { inputTokens: number; outputTokens: number },
  price: Price,
): number {
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

export function usageCostUsd(config: EvalConfig, usage: Usage[]): number {
  return usage.reduce((n, u) => n + costUsd(u, priceFor(config, u.requestedModel ?? u.model)), 0);
}

export type Range = { low: number; high: number };

export type Estimate = {
  prs: number;
  reviewerInputTokens: Range;
  reviewerUsd: Range;
  judgeUsd: Range;
  totalUsd: Range;
};

// Pre-run estimate. Prompt sizes are measured (rendered locally, for free);
// output sizes and candidate counts are the assumptions kept in the config.
// Input tokens come from prompt characters and a measured chars-per-token range.
export function estimateRun(
  config: EvalConfig,
  prompts: { chars: number; goldenCount: number }[],
  reviewerCallsPerPr = 1,
): Estimate {
  const reviewer = priceFor(config, config.reviewer.model);
  const judge = priceFor(config, config.judge.model);
  const a = config.estimate;
  const chars = prompts.reduce((n, p) => n + p.chars, 0);
  const golden = prompts.reduce((n, p) => n + p.goldenCount, 0);
  const n = prompts.length;
  const input = {
    low: (chars / a.promptCharsPerToken.low) * reviewerCallsPerPr,
    high: (chars / a.promptCharsPerToken.high) * reviewerCallsPerPr,
  };
  const output = {
    low: a.reviewerOutputTokens.low * n * reviewerCallsPerPr,
    high: a.reviewerOutputTokens.high * n * reviewerCallsPerPr,
  };
  const judgeSide = (candidates: number) =>
    costUsd(
      {
        inputTokens: golden * candidates * a.judgeCallTokens.input + n * a.extractDedupTokens.input,
        outputTokens:
          golden * candidates * a.judgeCallTokens.output + n * a.extractDedupTokens.output,
      },
      judge,
    );
  const reviewerUsd = {
    low: costUsd({ inputTokens: input.low, outputTokens: output.low }, reviewer),
    high: costUsd({ inputTokens: input.high, outputTokens: output.high }, reviewer),
  };
  const judgeUsd = {
    low: judgeSide(a.candidatesPerPr.low),
    high: judgeSide(a.candidatesPerPr.high),
  };
  return {
    prs: n,
    reviewerInputTokens: input,
    reviewerUsd,
    judgeUsd,
    totalUsd: { low: reviewerUsd.low + judgeUsd.low, high: reviewerUsd.high + judgeUsd.high },
  };
}

// Hard rule: stop when actual spend exceeds the approved estimate by 25%.
export const OVERRUN_FACTOR = 1.25;

export function capUsd(approvedUsd: number): number {
  return approvedUsd * OVERRUN_FACTOR;
}

export function overCap(actualUsd: number, approvedUsd: number): boolean {
  return actualUsd > capUsd(approvedUsd);
}

export function renderEstimate(e: Estimate, config: EvalConfig): string {
  const r = (x: Range) => `$${x.low.toFixed(2)} – $${x.high.toFixed(2)}`;
  const k = (x: number) => `${Math.round(x / 1000)}k`;
  return [
    `Estimate for ${e.prs} PR(s) — assumptions in the eval config, not a result`,
    `  reviewer ${config.reviewer.model}: ${k(e.reviewerInputTokens.low)}–${k(e.reviewerInputTokens.high)} input tokens, ${r(e.reviewerUsd)}`,
    `  judge    ${config.judge.model}: ${r(e.judgeUsd)}`,
    `  total    ${r(e.totalUsd)}`,
    `  a run stops above ${OVERRUN_FACTOR}x the approved amount`,
  ].join('\n');
}

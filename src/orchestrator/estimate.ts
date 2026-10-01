import { approxTokens } from '../chunker/chunk.js';

export type ConsensusEstimate = {
  calls: number; // reviewer passes + judge
  inputTokens: number; // prompt-side only; excludes model output/thinking and CLI overhead
};

const PERSONA_HEADER_TOKENS = 150; // persona block prepended to each reviewer prompt
const JUDGE_INSTRUCTION_TOKENS = 700;
const EST_REVIEW_OUTPUT_TOKENS = 800; // each reviewer's response feeds the judge's input

export function estimateConsensusTokens(
  renderedPrompt: string,
  diff: string,
  reviewers: number,
): ConsensusEstimate {
  const perReviewer = approxTokens(renderedPrompt) + PERSONA_HEADER_TOKENS;
  const judgeInput =
    JUDGE_INSTRUCTION_TOKENS + approxTokens(diff) + reviewers * EST_REVIEW_OUTPUT_TOKENS;
  return {
    calls: reviewers + 1,
    inputTokens: reviewers * perReviewer + judgeInput,
  };
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${Math.round(n / 1000)}k`;
}

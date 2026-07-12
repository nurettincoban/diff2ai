import type { Persona } from './personas.js';

export type IterationReview = {
  persona: Persona;
  output: string;
};

export const NO_ISSUES_SENTINEL = 'No validated issues.';

export function buildJudgePrompt(diff: string, reviews: IterationReview[]): string {
  const n = reviews.length;
  const parts: string[] = [
    '# Consolidation and Validation Instructions',
    '',
    `You are the judge for a multi-reviewer code review. You receive the ground-truth diff and ${n} independent reviews of it. Produce ONE consolidated review. Output ONLY numbered issue blocks in the schema below; no preamble, no commentary.`,
    '',
    'Procedure (follow strictly, in order):',
    '',
    '1. VALIDATE each finding from every review against the diff:',
    '   - Every `Affected: path:lineStart-lineEnd` must reference a file that appears in a `diff --git` header of the diff, and code that is visibly added or modified in the diff.',
    '   - DISCARD any finding whose file or claimed code does not appear in the diff, or whose description is contradicted by the diff. Do not mention discarded items.',
    '2. DEDUPLICATE: findings from different reviewers describing the same underlying problem at the same location are ONE finding. Keep the clearest explanation and the most complete proposed fix.',
    `3. CONSENSUS: for each surviving finding, count how many of the ${n} reviewers reported it (a reviewer counts if any of their findings matched during deduplication).`,
    '4. SORT by Severity (CRITICAL first, then HIGH, MEDIUM, LOW, INFO), then by consensus (descending).',
    '',
    `If no findings survive validation, output exactly: ${NO_ISSUES_SENTINEL}`,
    '',
    'Output schema — identical to the reviewer schema, with one added Consensus line:',
    '',
    '```',
    '## <n>) Severity: CRITICAL|HIGH|MEDIUM|LOW|INFO | Type: Implementation|Bug|Security|Test|Performance|Style|Doc|Maintainability',
    `Consensus: <k>/${n} reviewers`,
    'Title: <short imperative>',
    '',
    'Affected:',
    '- path/to/file.ext:lineStart-lineEnd',
    '',
    'Explanation:',
    '<what is wrong, why it matters, how to fix>',
    '',
    'Proposed fix:',
    '~~~<lang>',
    '<minimal snippet or steps>',
    '~~~',
    '```',
    '',
    '--- START DIFF ---',
    diff,
    '--- END DIFF ---',
  ];
  reviews.forEach((r, i) => {
    parts.push(
      '',
      `--- REVIEW ${i + 1} (persona: ${r.persona.name}) ---`,
      r.output.trim(),
      `--- END REVIEW ${i + 1} ---`,
    );
  });
  return parts.join('\n');
}

// Cheap sanity check that the judge actually produced a consolidated review
// (issue blocks or the explicit no-issues sentinel) rather than chatter.
export function isValidJudgeOutput(output: string): boolean {
  const trimmed = output.trim();
  if (trimmed.length === 0) return false;
  return /^## \d+\)/m.test(trimmed) || trimmed.includes(NO_ISSUES_SENTINEL);
}

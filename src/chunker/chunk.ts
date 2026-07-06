import { PROFILES, type ProfileName } from './profiles.js';

export type Chunk = { filename: string; content: string };

const DEFAULT_HEADER = `# Enforced Code Review Instructions\n\nYou are an AI code reviewer. Output ONLY numbered issue blocks as per the schema. Do not echo the diff or add preambles.\nFor chunked reviews, do not assume context outside this chunk.\n`;

// Naive token estimation: ~4 chars per token
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkDiff(
  unifiedDiff: string,
  profile: ProfileName,
  wrap: (diff: string) => string = wrapAsMarkdown,
): { chunks: Chunk[]; warnings: string[] } {
  const warnings: string[] = [];
  const budget = PROFILES[profile].tokenBudget;
  const batches =
    approxTokens(unifiedDiff) <= budget
      ? [unifiedDiff]
      : packIntoBatches(splitByFile(unifiedDiff), budget, profile, warnings);

  const chunks: Chunk[] = batches.map((b, i) => ({
    filename: `batch_${i + 1}.md`,
    content: wrap(b),
  }));
  return { chunks, warnings };
}

// Split into per-file sections, each keeping its `diff --git` header line.
// Content before the first header (e.g. commit metadata from `git show`) becomes
// a leading section; concatenating all sections reconstructs the input exactly.
function splitByFile(unifiedDiff: string): string[] {
  return unifiedDiff.split(/(?=^diff --git )/m).filter((s) => s.length > 0);
}

function packIntoBatches(
  sections: string[],
  budget: number,
  profile: ProfileName,
  warnings: string[],
): string[] {
  const batches: string[] = [];
  let current = '';
  for (const section of sections) {
    if (approxTokens(section) > budget) {
      // A single file too large for the budget: keep it whole in its own batch
      if (current) {
        batches.push(current);
        current = '';
      }
      const file = /^diff --git a\/.*? b\/(.*)$/m.exec(section)?.[1] ?? '(unknown file)';
      warnings.push(
        `File ${file} (~${approxTokens(section)} tokens) exceeds the ${profile} budget (${budget}); batch_${batches.length + 1}.md is over budget.`,
      );
      batches.push(section);
      continue;
    }
    const next = current + section;
    if (approxTokens(next) > budget && current) {
      batches.push(current);
      current = section;
    } else {
      current = next;
    }
  }
  if (current) batches.push(current);
  return batches;
}

function wrapAsMarkdown(diff: string): string {
  return `${DEFAULT_HEADER}\n--- START DIFF ---\n${diff}\n--- END DIFF ---\n`;
}

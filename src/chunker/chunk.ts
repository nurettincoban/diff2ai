import { parseHunkHeader, sectionPath, splitFileSections } from '../git/diffParse.js';

export type Chunk = { filename: string; content: string };

export type BatchInfo = { index: number; total: number };

export type ChunkOptions = {
  budget: number; // max tokens per rendered batch
  label?: string; // shown in warnings, e.g. the profile name
  // Renders a batch of raw diff into its final prompt (template, line numbers...)
  wrap?: (diff: string, batch: BatchInfo) => string;
  // Token cost of a raw diff fragment once rendered (e.g. with line numbers).
  // Defaults to approxTokens.
  cost?: (diff: string) => number;
};

const DEFAULT_HEADER = `# Enforced Code Review Instructions\n\nYou are an AI code reviewer. Output ONLY numbered issue blocks as per the schema. Do not echo the diff or add preambles.\nFor chunked reviews, do not assume context outside this chunk.\n`;

// Naive token estimation: ~4 chars per token
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkDiff(
  unifiedDiff: string,
  options: ChunkOptions,
): { chunks: Chunk[]; warnings: string[] } {
  const warnings: string[] = [];
  const wrap = options.wrap ?? ((d: string) => wrapAsMarkdown(d));
  const cost = options.cost ?? approxTokens;
  const label = options.label ?? 'token';
  // The template around each batch counts against the budget too.
  const overhead = approxTokens(wrap('', { index: 1, total: 1 }));
  const budget = Math.max(1, options.budget - overhead);

  const batches =
    cost(unifiedDiff) <= budget
      ? [unifiedDiff]
      : packIntoBatches(splitBySize(unifiedDiff, budget, cost, label, warnings), budget, cost);

  const chunks: Chunk[] = batches.map((b, i) => ({
    filename: `batch_${i + 1}.md`,
    content: wrap(b, { index: i + 1, total: batches.length }),
  }));
  return { chunks, warnings };
}

// Per-file sections; a file larger than the budget is split at hunk
// boundaries into parts that each repeat the file header, so every part is
// still a valid diff a reviewer can read on its own.
function splitBySize(
  diff: string,
  budget: number,
  cost: (s: string) => number,
  label: string,
  warnings: string[],
): string[] {
  const out: string[] = [];
  for (const section of splitFileSections(diff)) {
    if (cost(section) <= budget) {
      out.push(section);
      continue;
    }
    const file = sectionPath(section) ?? '(unknown file)';
    const { header, hunks } = splitHunks(section);
    if (hunks.length <= 1) {
      warnings.push(
        `File ${file} (~${cost(section)} tokens) exceeds the ${label} budget (${budget}) and has a single hunk; its batch is over budget.`,
      );
      out.push(section);
      continue;
    }
    let current = '';
    for (const hunk of hunks) {
      if (cost(header + hunk) > budget) {
        warnings.push(
          `A hunk in ${file} (~${cost(header + hunk)} tokens) exceeds the ${label} budget (${budget}); its batch is over budget.`,
        );
      }
      if (current && cost(header + current + hunk) > budget) {
        out.push(header + current);
        current = '';
      }
      current += hunk;
    }
    if (current) out.push(header + current);
  }
  return out;
}

function splitHunks(section: string): { header: string; hunks: string[] } {
  const lines = section.split(/(?<=\n)/); // keep line endings
  let i = 0;
  let header = '';
  while (i < lines.length && !parseHunkHeader(lines[i])) header += lines[i++];
  const hunks: string[] = [];
  for (; i < lines.length; i++) {
    if (parseHunkHeader(lines[i]) || hunks.length === 0) hunks.push(lines[i]);
    else hunks[hunks.length - 1] += lines[i];
  }
  return { header, hunks };
}

function packIntoBatches(parts: string[], budget: number, cost: (s: string) => number): string[] {
  const batches: string[] = [];
  let current = '';
  for (const part of parts) {
    const next = current + part;
    if (current && cost(next) > budget) {
      batches.push(current);
      current = part;
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

import { approxTokens, chunkDiff, type BatchInfo, type Chunk } from '../chunker/chunk.js';
import { diffFileStats, formatFileStats } from '../git/diffParse.js';
import { annotateLineNumbers } from './annotate.js';
import { renderTemplate, type TemplateVars } from './markdown.js';

export type PromptSpec = {
  template: string; // template name, or an absolute .md path
  templatesDir?: string; // absolute
  root: string; // project root for resolving ./templates
  lineNumbers: boolean;
  vars?: Omit<TemplateVars, 'file_stats'>;
};

export type BuiltPrompts =
  | { kind: 'single'; prompt: string; tokens: number }
  | { kind: 'batches'; chunks: Chunk[]; warnings: string[]; tokens: number };

function diffForPrompt(diff: string, spec: PromptSpec): string {
  return spec.lineNumbers ? annotateLineNumbers(diff) : diff;
}

function batchNote(batch: BatchInfo): string {
  if (batch.total <= 1) return '';
  return (
    `# Batch ${batch.index} of ${batch.total}: this part of the diff contains only some of the changed files. ` +
    'Review only what is shown here; other files are reviewed in separate batches.\n'
  );
}

// Renders the whole diff into one prompt. The file list always describes the
// full change, even when the diff itself is split into batches.
export function renderPrompt(diff: string, spec: PromptSpec, fileStats?: string): string {
  return renderTemplate(spec.template, diffForPrompt(diff, spec), {
    cwd: spec.root,
    templatesDir: spec.templatesDir,
    vars: { ...spec.vars, file_stats: fileStats ?? formatFileStats(diffFileStats(diff)) },
  });
}

// One prompt when it fits the budget, otherwise template-wrapped batches.
export function buildPrompts(
  diff: string,
  spec: PromptSpec,
  budget: { budget: number; label: string },
): BuiltPrompts {
  const fileStats = formatFileStats(diffFileStats(diff));
  const single = renderPrompt(diff, spec, fileStats);
  const tokens = approxTokens(single);
  if (tokens <= budget.budget) return { kind: 'single', prompt: single, tokens };

  const { chunks, warnings } = chunkDiff(diff, {
    budget: budget.budget,
    label: budget.label,
    cost: (d) => approxTokens(diffForPrompt(d, spec)),
    wrap: (d, batch) =>
      renderTemplate(spec.template, batchNote(batch) + diffForPrompt(d, spec), {
        cwd: spec.root,
        templatesDir: spec.templatesDir,
        vars: { ...spec.vars, file_stats: fileStats },
      }),
  });
  return { kind: 'batches', chunks, warnings, tokens };
}

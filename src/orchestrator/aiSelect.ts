import { runHeadless } from '../runners/execute.js';
import { diffFileStats, walkDiff } from '../git/diffParse.js';
import type { ResolvedRunner } from '../runners/types.js';
import type { Persona } from './personas.js';
import type { PersonaSuggestion } from './signals.js';

const MAX_SAMPLE_LINES = 50;
const MAX_SAMPLE_CHARS = 2500;
const MAX_LINE_CHARS = 160;

export const SELECTION_MARKER = 'Output ONLY persona selections';

// Compact change summary — file stats plus a capped sample of added lines —
// so persona selection costs a tiny AI call, never a full-diff read.
export function diffSummary(diff: string): string {
  const sample: string[] = [];
  let sampleChars = 0;
  walkDiff(diff, (line, kind) => {
    if (kind !== 'add') return;
    if (sample.length < MAX_SAMPLE_LINES && sampleChars < MAX_SAMPLE_CHARS) {
      const trimmed = line.slice(1, MAX_LINE_CHARS + 1);
      sample.push(trimmed);
      sampleChars += trimmed.length;
    }
  });
  const files = diffFileStats(diff)
    .map((s) => `- ${s.path} (+${s.added}/-${s.removed})`)
    .join('\n');
  return `Files changed:\n${files}\n\nSample of added lines:\n\`\`\`\n${sample.join('\n')}\n\`\`\``;
}

export function buildSelectionPrompt(diff: string, pool: Persona[]): string {
  const catalog = pool.map((p) => `- ${p.slug}: ${p.name} — ${p.instructions}`).join('\n');
  return [
    'You are selecting code reviewers for a change. From the catalog below, choose between 2 and 4 reviewer personas that best match the actual risks of this change. Understand what the change does — do not keyword-match.',
    '',
    'Catalog:',
    catalog,
    '',
    'Change summary:',
    diffSummary(diff),
    '',
    `${SELECTION_MARKER}, one per line, in the exact format:`,
    'slug: short reason tied to this specific change',
    'No other text before or after.',
  ].join('\n');
}

export function parseSelection(output: string, pool: Persona[]): PersonaSuggestion[] {
  const valid = new Set(pool.map((p) => p.slug));
  const seen = new Set<string>();
  const suggestions: PersonaSuggestion[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^[-*\s]*([a-z0-9-]+)\s*:\s*(.+)$/i.exec(line.trim());
    if (!m) continue;
    const slug = m[1].toLowerCase();
    if (!valid.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    suggestions.push({ slug, reason: m[2].trim() });
    if (suggestions.length >= 5) break;
  }
  return suggestions;
}

// One small headless call to pick reviewers. Returns null when the runner
// fails or the output is unusable — callers fall back to the free heuristics.
export async function aiSuggestPersonas(
  runner: ResolvedRunner,
  diff: string,
  pool: Persona[],
): Promise<PersonaSuggestion[] | null> {
  const prompt = buildSelectionPrompt(diff, pool);
  const res = await runHeadless(runner, prompt);
  if (!res.ok) return null;
  const suggestions = parseSelection(res.output, pool);
  return suggestions.length >= 2 ? suggestions : null;
}

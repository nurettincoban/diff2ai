import { PROFILES, type ProfileName } from './profiles.js';

export type Chunk = { filename: string; content: string };

export function chunkDiff(
  unifiedDiff: string,
  profile: ProfileName,
): { chunks: Chunk[]; warnings: string[] } {
  const warnings: string[] = [];
  const budget = PROFILES[profile].tokenBudget;
  // Naive token estimation: ~4 chars per token
  const approxTokens = Math.ceil(unifiedDiff.length / 4);
  if (approxTokens <= budget) {
    return { chunks: [{ filename: 'batch_1.md', content: wrapAsMarkdown(unifiedDiff) }], warnings };
  }

  // Split by files to keep related changes together
  const files = unifiedDiff.split(/^diff --git .*$/gm).filter((s) => s.trim().length > 0);
  const batches: string[] = [];
  let current = '';
  for (const f of files) {
    const next = current ? joinWithOverlap(current, f) : f;
    const nextTokens = Math.ceil(next.length / 4);
    if (nextTokens > budget && current) {
      batches.push(current);
      current = f;
    } else {
      current = next;
    }
  }
  if (current) batches.push(current);

  const chunks: Chunk[] = batches.map((b, i) => ({ filename: `batch_${i + 1}.md`, content: wrapAsMarkdown(b) }));
  return { chunks, warnings };
}

function wrapAsMarkdown(diff: string): string {
  return `--- START DIFF ---\n${diff}\n--- END DIFF ---\n`;
}

function joinWithOverlap(a: string, b: string): string {
  const aLines = a.split(/\r?\n/);
  const overlap = aLines.slice(-20).join('\n');
  return a + '\n' + overlap + '\n' + b;
}

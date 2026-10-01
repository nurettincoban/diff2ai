import { describe, it, expect } from 'vitest';
import { chunkDiff, approxTokens } from '../src/chunker/chunk.js';
import { PROFILES } from '../src/chunker/profiles.js';

function fileSection(name: string, bodyLines: number): string {
  const lines = [
    `diff --git a/${name} b/${name}`,
    `index 0000000..1111111 100644`,
    `--- a/${name}`,
    `+++ b/${name}`,
    `@@ -0,0 +1,${bodyLines} @@`,
  ];
  for (let i = 0; i < bodyLines; i++) {
    lines.push(`+line ${i} of ${name} ${'x'.repeat(60)}`);
  }
  return lines.join('\n') + '\n';
}

function extractDiff(batchContent: string): string {
  const start = batchContent.indexOf('--- START DIFF ---\n');
  const end = batchContent.lastIndexOf('\n--- END DIFF ---');
  return batchContent.slice(start + '--- START DIFF ---\n'.length, end);
}

describe('chunkDiff', () => {
  const budget = PROFILES['generic-medium'].tokenBudget;

  it('returns a single batch when under budget', () => {
    const diff = fileSection('a.txt', 10) + fileSection('b.txt', 10);
    const { chunks, warnings } = chunkDiff(diff, { budget, label: 'generic-medium' });
    expect(chunks).toHaveLength(1);
    expect(warnings).toHaveLength(0);
    expect(extractDiff(chunks[0].content)).toBe(diff);
  });

  it('keeps diff --git headers on every batch and loses no content', () => {
    // Each section is ~1/3 of the budget so several batches are needed
    const linesPerFile = Math.ceil((budget * 4) / 3 / 70);
    const sections = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'].map((n) =>
      fileSection(n, linesPerFile),
    );
    const diff = sections.join('');
    expect(approxTokens(diff)).toBeGreaterThan(budget);

    const { chunks, warnings } = chunkDiff(diff, { budget, label: 'generic-medium' });
    expect(chunks.length).toBeGreaterThan(1);
    expect(warnings).toHaveLength(0);

    const bodies = chunks.map((c) => extractDiff(c.content));
    for (const body of bodies) {
      expect(body.startsWith('diff --git ')).toBe(true);
      expect(approxTokens(body)).toBeLessThanOrEqual(budget);
    }
    // Concatenated batches reconstruct the original diff exactly
    expect(bodies.join('')).toBe(diff);
  });

  it('warns when a single file exceeds the budget but keeps it whole', () => {
    const oversizedLines = Math.ceil((budget * 4 * 1.5) / 70);
    const diff = fileSection('small.ts', 10) + fileSection('huge.bin.ts', oversizedLines);
    const { chunks, warnings } = chunkDiff(diff, { budget, label: 'generic-medium' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('huge.bin.ts');
    expect(extractDiff(chunks[chunks.length - 1].content)).toContain('diff --git a/huge.bin.ts');
    expect(chunks.map((c) => extractDiff(c.content)).join('')).toBe(diff);
  });

  it('uses a custom wrapper when provided', () => {
    const diff = fileSection('a.txt', 5);
    const { chunks } = chunkDiff(diff, { budget, wrap: (d) => `WRAPPED:${d}` });
    expect(chunks[0].content).toBe(`WRAPPED:${diff}`);
  });

  it('splits an oversized multi-hunk file at hunk boundaries, repeating the file header', () => {
    const hunkLines = Math.ceil((budget * 4) / 2 / 70); // each hunk ~half the budget
    const header = [
      'diff --git a/big.ts b/big.ts',
      'index 0000000..1111111 100644',
      '--- a/big.ts',
      '+++ b/big.ts',
    ].join('\n');
    const hunks = [0, 1, 2].map((h) => {
      const start = 1 + h * (hunkLines + 10);
      const body = Array.from(
        { length: hunkLines },
        (_, i) => `+hunk ${h} line ${i} ${'y'.repeat(60)}`,
      );
      return [`@@ -${start},0 +${start},${hunkLines} @@`, ...body].join('\n');
    });
    const diff = `${header}\n${hunks.join('\n')}\n`;
    const { chunks, warnings } = chunkDiff(diff, { budget, label: 'generic-medium' });
    expect(warnings).toHaveLength(0);
    expect(chunks.length).toBeGreaterThan(1);
    const bodies = chunks.map((c) => extractDiff(c.content));
    for (const body of bodies) {
      expect(body.startsWith('diff --git a/big.ts b/big.ts\n')).toBe(true);
      expect(approxTokens(body)).toBeLessThanOrEqual(budget);
    }
    // every hunk survives exactly once
    for (let h = 0; h < 3; h++) {
      expect(bodies.filter((b) => b.includes(`+hunk ${h} line 0 `))).toHaveLength(1);
    }
  });

  it('counts the wrapper template against the budget', () => {
    const big = fileSection('a.ts', Math.ceil((budget * 4 * 0.9) / 70));
    const wrapper = (d: string) => `${'T'.repeat(budget * 4 * 0.2)}${d}`;
    const { chunks } = chunkDiff(big + fileSection('b.ts', 10), { budget, wrap: wrapper });
    expect(chunks.length).toBe(2);
  });
});

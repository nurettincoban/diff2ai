import { describe, it, expect } from 'vitest';
import {
  buildDiffIndex,
  changedFiles,
  diffFileStats,
  formatFileStats,
  parseDiffGitHeader,
  walkDiff,
} from '../src/git/diffParse.js';
import { applyIgnoreFilter } from '../src/git/diff.js';
import { annotateLineNumbers } from '../src/formatters/annotate.js';
import { parseAffected, reportsNoIssues } from '../src/formatters/findings.js';

const MODIFIED = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -10,4 +10,5 @@ function main() {',
  '   const a = 1;',
  '-  const b = 2;',
  '+  const b = 3;',
  '+  const c = 4;',
  '   return a + b;',
  ' }',
  '',
].join('\n');

const ADDED = [
  'diff --git a/docs/new file.md b/docs/new file.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/docs/new file.md',
  '@@ -0,0 +1,2 @@',
  '+# Title',
  '+-- not a header',
  '',
].join('\n');

describe('parseDiffGitHeader', () => {
  it('parses plain, spaced, renamed, and quoted paths', () => {
    expect(parseDiffGitHeader('diff --git a/src/a.ts b/src/a.ts')).toEqual({
      oldPath: 'src/a.ts',
      newPath: 'src/a.ts',
    });
    expect(parseDiffGitHeader('diff --git a/my b/file.txt b/my b/file.txt')).toEqual({
      oldPath: 'my b/file.txt',
      newPath: 'my b/file.txt',
    });
    expect(parseDiffGitHeader('diff --git a/old.ts b/new.ts')).toEqual({
      oldPath: 'old.ts',
      newPath: 'new.ts',
    });
    expect(parseDiffGitHeader('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"')).toEqual({
      oldPath: 'café.txt',
      newPath: 'café.txt',
    });
    expect(parseDiffGitHeader('diff --git a/x.ts b/x.ts\r')?.newPath).toBe('x.ts');
    expect(parseDiffGitHeader('index 123..456')).toBeNull();
  });
});

describe('walkDiff / stats / index', () => {
  it('uses hunk counts so "--" and "++" body lines are not headers', () => {
    const kinds: string[] = [];
    walkDiff(ADDED, (_l, kind) => kinds.push(kind));
    expect(kinds.filter((k) => k === 'add')).toHaveLength(2);
  });

  it('computes per-file stats and a readable summary', () => {
    const stats = diffFileStats(MODIFIED + ADDED);
    expect(stats).toEqual([
      { path: 'src/app.ts', oldPath: undefined, status: 'modified', added: 2, removed: 1 },
      { path: 'docs/new file.md', oldPath: undefined, status: 'added', added: 2, removed: 0 },
    ]);
    const text = formatFileStats(stats);
    expect(text).toContain('- src/app.ts (+2/-1)');
    expect(text).toContain('- docs/new file.md (new file, +2/-0)');
    expect(text).toContain('Total: 2 file(s), +4/-1');
    expect(changedFiles(MODIFIED + ADDED)).toEqual(['src/app.ts', 'docs/new file.md']);
  });

  it('indexes new-file hunk ranges', () => {
    expect(buildDiffIndex(MODIFIED).get('src/app.ts')).toEqual([[10, 14]]);
  });
});

describe('annotateLineNumbers', () => {
  it('prefixes hunk lines with new-file line numbers and leaves headers alone', () => {
    const out = annotateLineNumbers(MODIFIED).split('\n');
    expect(out[0]).toBe('diff --git a/src/app.ts b/src/app.ts');
    expect(out[4]).toBe('@@ -10,4 +10,5 @@ function main() {');
    expect(out[5]).toBe('  10    const a = 1;');
    expect(out[6]).toBe('     -  const b = 2;');
    expect(out[7]).toBe('  11 +  const b = 3;');
    expect(out[8]).toBe('  12 +  const c = 4;');
    expect(out[9]).toBe('  13    return a + b;');
    expect(out[10]).toBe('  14  }');
  });
});

describe('applyIgnoreFilter', () => {
  it('drops ignored sections and keeps the rest byte-for-byte (CRLF included)', () => {
    const crlf = MODIFIED.replace(/\n/g, '\r\n');
    const excluded: string[] = [];
    const out = applyIgnoreFilter(
      crlf + ADDED,
      (p) => p.endsWith('.md'),
      (f) => excluded.push(f),
    );
    expect(out).toBe(crlf);
    expect(excluded).toEqual(['docs/new file.md']);
  });
});

describe('findings helpers', () => {
  it('parses Affected entries', () => {
    expect(parseAffected('src/a.ts:10-12')).toEqual({ path: 'src/a.ts', start: 10, end: 12 });
    expect(parseAffected('`src/a.ts:7`')).toEqual({ path: 'src/a.ts', start: 7, end: 7 });
    expect(parseAffected('src/a.ts')).toEqual({ path: 'src/a.ts' });
  });

  it('recognizes explicit no-issue answers', () => {
    expect(reportsNoIssues('No issues found.')).toBe(true);
    expect(reportsNoIssues('<!-- note -->\n\nNo validated issues.')).toBe(true);
    expect(reportsNoIssues('## 1) Severity: LOW | Type: Doc')).toBe(false);
  });
});

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
import { parseAffected, parseFindings, reportsNoIssues } from '../src/formatters/findings.js';
import { hasLocation, toSarif } from '../src/formatters/export.js';
import { remoteHost } from '../src/commands/post.js';

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

describe('renames whose old path contains " b/"', () => {
  const RENAME = [
    'diff --git a/my b/file.txt b/my b/renamed file.txt',
    'similarity index 90%',
    'rename from my b/file.txt',
    'rename to my b/renamed file.txt',
    'index 1111111..2222222 100644',
    '--- a/my b/file.txt',
    '+++ b/my b/renamed file.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '',
  ].join('\n');

  it('takes the new path from the rename/+++ lines', () => {
    expect(changedFiles(RENAME)).toEqual(['my b/renamed file.txt']);
    expect(buildDiffIndex(RENAME).get('my b/renamed file.txt')).toEqual([[1, 1]]);
    expect(diffFileStats(RENAME)[0]).toMatchObject({
      path: 'my b/renamed file.txt',
      oldPath: 'my b/file.txt',
      status: 'renamed',
    });
    expect(applyIgnoreFilter(RENAME, (p) => p === 'my b/renamed file.txt')).toBe('');
  });
});

describe('findings helpers', () => {
  it('keeps every Affected entry and multi-line explanations', () => {
    const [f] = parseFindings(
      [
        '## 1) Severity: HIGH | Type: Bug',
        'Title: Off by one',
        '',
        'Affected:',
        '- big.txt:5',
        '- big.txt:9-12',
        '',
        'Explanation:',
        'The loop runs one past the end.',
        'This reads uninitialized memory.',
        'Fix the bound.',
      ].join('\n'),
    );
    expect(f.affected).toEqual(['big.txt:5', 'big.txt:9-12']);
    expect(f.explanation).toBe(
      'The loop runs one past the end.\nThis reads uninitialized memory.\nFix the bound.',
    );
  });

  it('detects the platform from the remote host only', () => {
    expect(remoteHost('git@gitlab.com:acme/github-sync.git')).toBe('gitlab.com');
    expect(remoteHost('https://github.com/acme/gitlab-tools.git')).toBe('github.com');
    expect(remoteHost('ssh://git@github.example.com:2222/acme/app.git')).toBe('github.example.com');
  });

  it('leaves findings without a location out of SARIF', () => {
    const findings = parseFindings(
      [
        '## 1) Severity: HIGH | Type: Bug',
        'Title: Located',
        'Affected:',
        '- a.ts:1',
        '',
        '## 2) Severity: LOW | Type: Doc',
        'Title: General remark',
        'Explanation:',
        'No file.',
      ].join('\n'),
    );
    expect(findings.filter(hasLocation)).toHaveLength(1);
    const sarif = JSON.parse(toSarif(findings, { version: 'test' }));
    expect(sarif.runs[0].results).toHaveLength(1);
    expect(sarif.runs[0].results[0].locations).toHaveLength(1);
  });

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

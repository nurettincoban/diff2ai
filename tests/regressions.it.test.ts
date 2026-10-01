import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  diff2ai,
  ensureBuilt,
  listReviews,
  readReview,
  repoWithOrigin,
  run,
  runFail,
  cli,
  tmpDir,
  write,
} from './helpers.js';

// One test per bug found in the 0.2.x analysis; each failed before the fix.
describe('regressions', () => {
  beforeAll(ensureBuilt);

  function featureRepo(prefix: string) {
    const { repo } = repoWithOrigin(prefix);
    run('git checkout -q -b feature/x', repo);
    write(repo, 'src/keep.ts', 'export const a = 1;\n');
    write(repo, 'notes.log', 'log\n');
    run('git add .', repo);
    run('git commit -q -m "feat: add keep and log"', repo);
    return repo;
  }

  it('ignores user git config that changes diff output (color, prefixes)', () => {
    const repo = featureRepo('d2a-gitcfg-');
    run('git config color.diff always', repo);
    run('git config color.ui always', repo);
    run('git config diff.noprefix true', repo);
    run('git config diff.mnemonicPrefix true', repo);
    write(repo, '.aidiffignore', '*.log\n');
    diff2ai('review feature/x --target main', repo);
    const prompt = readReview(repo, (f) => f.startsWith('review_') && f.endsWith('.md'));
    expect(prompt).not.toMatch(/\x1b\[/); // eslint-disable-line no-control-regex
    expect(prompt).toContain('diff --git a/src/keep.ts b/src/keep.ts');
    expect(prompt).not.toContain('notes.log');
  });

  it('applies the template from .aidiff.json (review and prompt)', () => {
    const repo = featureRepo('d2a-cfgtpl-');
    write(repo, '.aidiff.json', "{ template: 'security' }");
    diff2ai('review feature/x --target main --save-diff', repo);
    expect(readReview(repo, (f) => f.startsWith('review_') && f.endsWith('.md'))).toMatch(
      /^# Security Review/,
    );
    const diffFile = listReviews(repo).find((f) => f.endsWith('.diff'))!;
    fs.rmSync(path.join(repo, 'reviews', diffFile.replace(/\.diff$/, '.md')));
    diff2ai(`prompt reviews/${diffFile}`, repo);
    expect(readReview(repo, (f) => f === diffFile.replace(/\.diff$/, '.md'))).toMatch(
      /^# Security Review/,
    );
  });

  it('works from a subdirectory and writes to <root>/reviews', () => {
    const repo = featureRepo('d2a-subdir-');
    write(repo, '.aidiff.json', "{ template: 'basic' }");
    const out = diff2ai('review feature/x --target main', path.join(repo, 'src'));
    expect(out).toMatch(/Review prompt ready/);
    expect(fs.existsSync(path.join(repo, 'src', 'reviews'))).toBe(false);
    expect(readReview(repo, (f) => f.endsWith('.md'))).toMatch(/^Review this diff/);
  });

  it('diff includes uncommitted work by default; --committed does not', () => {
    const repo = featureRepo('d2a-worktree-');
    write(repo, 'src/keep.ts', 'export const a = 2; // uncommitted\n');
    diff2ai('diff --no-interactive', repo);
    expect(readReview(repo, (f) => f.endsWith('.diff'))).toContain('uncommitted');
    fs.rmSync(path.join(repo, 'reviews'), { recursive: true });
    diff2ai('diff --no-interactive --committed', repo);
    const committed = readReview(repo, (f) => f.endsWith('.diff'));
    expect(committed).not.toContain('uncommitted');
    expect(committed).toContain('src/keep.ts');
  });

  it('show accepts refs with slashes and names the file by short SHA', () => {
    const repo = featureRepo('d2a-show-');
    const sha = run('git rev-parse --short feature/x', repo).trim();
    diff2ai('show feature/x', repo);
    expect(listReviews(repo).some((f) => f.startsWith(`commit_${sha}_`))).toBe(true);
  });

  it('doctor reports the real last fetch time', () => {
    const repo = featureRepo('d2a-doctor-');
    run('git fetch -q origin', repo);
    const out = diff2ai('doctor', repo);
    expect(out).toMatch(/Last fetch:\s+\d+s ago/);
  });

  it('rejects refs that would be parsed as git options', () => {
    const repo = featureRepo('d2a-optref-');
    expect(runFail(`node "${cli}" review --target main -- --output=pwned`, repo)).toMatch(
      /cannot start with "-"/,
    );
    expect(fs.existsSync(path.join(repo, 'pwned'))).toBe(false);
  });

  it('exits non-zero when not in a git repository', () => {
    const dir = tmpDir('d2a-nogit-');
    expect(runFail(`node "${cli}" diff`, dir)).toMatch(/Not a git repository/);
  });
});

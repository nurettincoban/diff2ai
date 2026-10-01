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

  // Found by the post-implementation review of 0.3.0
  it('show <merge commit> diffs against the first parent (no combined diff)', () => {
    const { repo } = repoWithOrigin('d2a-merge-');
    run('git checkout -q -b side', repo);
    write(repo, 'side.ts', 'export const s = 1;\n');
    write(repo, 'side.log', 'noise\n');
    run('git add . && git commit -q -m side', repo);
    run('git checkout -q main', repo);
    write(repo, 'main.ts', 'export const m = 1;\n');
    run('git add . && git commit -q -m main2', repo);
    run('git merge -q --no-edit side', repo);
    write(repo, '.aidiffignore', '*.log\n');
    diff2ai('show HEAD', repo);
    const diff = readReview(repo, (f) => f.startsWith('commit_'));
    expect(diff).toContain('diff --git a/side.ts b/side.ts');
    expect(diff).not.toContain('diff --cc');
    expect(diff).not.toContain('side.log');
  });

  it('a timed-out runner is actually stopped (SIGKILL escalation / Windows process tree)', () => {
    const repo = featureRepo('d2a-timeout-');
    const fakeRunner = path.join(path.dirname(cli), '..', 'tests', 'fixtures', 'fake-runner.mjs');
    let command = process.execPath;
    let args: string[] = [fakeRunner];
    if (process.platform === 'win32') {
      // npm-style .cmd shim: cmd.exe is the direct child, node its grandchild
      const shim = path.join(repo, 'slow-runner.cmd');
      fs.writeFileSync(shim, `@"${process.execPath}" "${fakeRunner}" %*\r\n`);
      command = shim;
      args = [];
    }
    write(
      repo,
      '.aidiff.json',
      JSON.stringify({ runners: { slow: { command, args, timeoutMs: 1000 } } }),
    );
    const started = Date.now();
    const out = runFail(`node "${cli}" review feature/x --target main --run slow`, repo, {
      FAKE_RUNNER_SLEEP_MS: '20000',
      FAKE_RUNNER_IGNORE_TERM: '1',
    });
    expect(out).toMatch(/timed out after 1s/);
    // Before the fix the CLI waited for the runner's full 20s.
    expect(Date.now() - started).toBeLessThan(12_000);
  });
});

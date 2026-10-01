import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  diff2ai,
  ensureBuilt,
  fixture,
  listReviews,
  readReview,
  repoWithOrigin,
  run,
  runFail,
  cli,
  tmpDir,
  write,
} from './helpers.js';
import { resolveRunner, listRunnerNames } from '../src/runners/resolve.js';
import { renderTemplate } from '../src/formatters/markdown.js';

const fakeRunner = fixture('fake-runner.mjs');
const fakeGh = fixture('fake-gh.mjs');

function featureRepo(prefix: string, extraConfig: Record<string, unknown> = {}) {
  const { repo, remote } = repoWithOrigin(prefix);
  run('git checkout -q -b feature/ctx', repo);
  write(repo, 'file.txt', 'hello\nworld\nagain\n');
  run('git add file.txt', repo);
  run('git commit -q -m "feat: add greeting file" -m "Explains why the greeting exists."', repo);
  write(
    repo,
    '.aidiff.json',
    JSON.stringify({
      runners: {
        fake: { command: process.execPath, args: [fakeRunner], headless: { input: 'stdin' } },
      },
      github: { command: process.execPath, args: [fakeGh] },
      ...extraConfig,
    }),
  );
  return { repo, remote };
}

describe('prompt context and line numbers', () => {
  beforeAll(ensureBuilt);

  it('fills {commits}, {file_stats}, {branch}, {target} and numbers diff lines', () => {
    const { repo } = featureRepo('d2a-ctx-');
    diff2ai('review feature/ctx --target main', repo);
    const prompt = readReview(repo, (f) => f.endsWith('.md'));
    expect(prompt).toContain('- Branch: feature/ctx → main');
    expect(prompt).toMatch(
      /- [0-9a-f]{7,} feat: add greeting file\n {2}Explains why the greeting exists\./,
    );
    expect(prompt).toContain('- file.txt (new file, +3/-0)');
    expect(prompt).toMatch(/\n {3}1 \+hello\n {3}2 \+world\n/);
    expect(prompt).not.toContain('{commits}');
  });

  it('--no-line-numbers keeps the raw diff; config lineNumbers:false does too', () => {
    const { repo } = featureRepo('d2a-nolines-');
    diff2ai('review feature/ctx --target main --no-line-numbers', repo);
    expect(readReview(repo, (f) => f.endsWith('.md'))).toMatch(/\n\+hello\n/);
  });

  it('reviews the current branch when no ref is given', () => {
    const { repo } = featureRepo('d2a-head-');
    const out = diff2ai('review --target main', repo);
    expect(out).toMatch(/ref: feature\/ctx/);
    expect(readReview(repo, (f) => f.endsWith('.md'))).toContain('+hello');
  });

  it('renders missing context as "(not available)" and never re-substitutes diff text', () => {
    const dir = tmpDir('d2a-tpl-');
    write(dir, 'templates/t.md', '{branch}|{commits}\n{diff_content}');
    const out = renderTemplate('t', '+ literal {branch} and $& stay', {
      cwd: dir,
      vars: { branch: 'b1' },
    });
    expect(out).toBe('b1|(not available)\n+ literal {branch} and $& stay');
  });
});

describe('review --pr / --mr', () => {
  beforeAll(ensureBuilt);

  it('fetches refs/pull/<n>/head into a private ref and uses the PR base from gh', () => {
    const { repo } = featureRepo('d2a-pr-');
    run('git push -q origin feature/ctx:refs/pull/12/head', repo);
    run('git checkout -q main', repo);
    run('git branch -q -D feature/ctx', repo);
    const out = diff2ai('review --pr 12', repo, { FAKE_GH_BASE: 'main' });
    expect(out).toMatch(/ref: PR #12/);
    expect(run('git rev-parse --verify refs/diff2ai/pr-12', repo).trim()).toMatch(/^[0-9a-f]{40}$/);
    const prompt = readReview(repo, (f) => f.endsWith('.md'));
    expect(prompt).toContain('- Branch: PR #12 → main');
    expect(prompt).toContain('+hello');
    // still on main, no local branch created
    expect(run('git rev-parse --abbrev-ref HEAD', repo).trim()).toBe('main');
  });

  it('fetches refs/merge-requests/<iid>/head for --mr', () => {
    const { repo } = featureRepo('d2a-mr-');
    run('git push -q origin feature/ctx:refs/merge-requests/5/head', repo);
    run('git checkout -q main', repo);
    const out = diff2ai('review --mr 5 --target main', repo);
    expect(out).toMatch(/ref: MR !5/);
    expect(readReview(repo, (f) => f.endsWith('.md'))).toContain('+hello');
  });

  it('rejects combining a ref with --pr', () => {
    const { repo } = featureRepo('d2a-prref-');
    expect(runFail(`node "${cli}" review feature/ctx --pr 1`, repo)).toMatch(/not several/);
  });
});

describe('export and severity gates', () => {
  beforeAll(ensureBuilt);

  it('headless --run writes a response that export turns into SARIF/JSON, gated by --fail-on', () => {
    const { repo } = featureRepo('d2a-export-');
    diff2ai('review feature/ctx --target main --run fake', repo);
    expect(listReviews(repo).some((f) => f.endsWith('.response.md'))).toBe(true);

    const sarif = JSON.parse(run(`node "${cli}" export latest --format sarif`, repo));
    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].tool.driver.name).toBe('diff2ai');
    const result = sarif.runs[0].results[0];
    expect(result.level).toBe('error');
    expect(result.locations[0].physicalLocation).toEqual({
      artifactLocation: { uri: 'file.txt' },
      region: { startLine: 1, endLine: 2 },
    });

    const json = JSON.parse(
      run(`node "${cli}" export latest --format json --min-severity high`, repo),
    );
    expect(json.findings).toHaveLength(1);
    expect(json.findings[0]).toMatchObject({ severity: 'HIGH', verified: true });

    // gate: HIGH finding trips --fail-on high, not --fail-on critical
    expect(runFail(`node "${cli}" export latest --fail-on high --out out.json`, repo)).toMatch(
      /Severity gate failed: 1 finding/,
    );
    expect(diff2ai('export latest --fail-on critical --out out.json', repo)).toMatch(
      /Severity gate passed/,
    );
  });

  it('review --fail-on sets a failing exit code for headless runs', () => {
    const { repo } = featureRepo('d2a-failon-');
    expect(
      runFail(`node "${cli}" review feature/ctx --target main --run fake --fail-on high`, repo),
    ).toMatch(/Severity gate failed/);
  });
});

describe('GitHub posting via gh', () => {
  beforeAll(ensureBuilt);

  function postSetup(prefix: string) {
    const { repo } = featureRepo(prefix);
    diff2ai('review feature/ctx --target main --run fake', repo);
    const prDiff = run('git diff --no-color main...feature/ctx', repo);
    write(repo, 'pr.diff', prDiff);
    const log = path.join(repo, 'gh.log');
    const env = { FAKE_GH_LOG: log, FAKE_GH_DIFF: path.join(repo, 'pr.diff') };
    const calls = () =>
      fs
        .readFileSync(log, 'utf-8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { args: string[]; input?: string });
    return { repo, env, calls };
  }

  it('posts a review with inline comments on changed lines', () => {
    const { repo, env, calls } = postSetup('d2a-ghpost-');
    const out = diff2ai('post latest --platform github --pr 7 --yes', repo, env);
    expect(out).toMatch(/Review posted on PR #7/);
    const api = calls().find((c) => c.args[0] === 'api')!;
    expect(api.args).toContain('repos/{owner}/{repo}/pulls/7/reviews');
    const payload = JSON.parse(api.input!);
    expect(payload.event).toBe('COMMENT');
    // file.txt:1-2 is inside the hunk → inline; file.txt:3-3 too
    expect(payload.comments).toHaveLength(2);
    expect(payload.comments[0]).toMatchObject({
      path: 'file.txt',
      start_line: 1,
      line: 2,
      side: 'RIGHT',
    });
    expect(payload.body).toMatch(/2 posted as inline comments/);
  });

  it('falls back to a single PR comment when the review API rejects it', () => {
    const { repo, env, calls } = postSetup('d2a-ghfallback-');
    const out = diff2ai('post latest --platform github --pr 7 --yes', repo, {
      ...env,
      FAKE_GH_REVIEW_FAIL: '1',
    });
    expect(out).toMatch(/single PR comment instead/);
    const comment = calls().find((c) => c.args[1] === 'comment')!;
    expect(comment.args).toEqual(['pr', 'comment', '7', '--body-file', '-']);
    expect(comment.input).toMatch(/AI review \(diff2ai\)/);
  });

  it('--no-inline posts one comment; --pr is inferred from the current branch', () => {
    const { repo, env, calls } = postSetup('d2a-ghnoinline-');
    diff2ai('post latest --platform github --no-inline --yes', repo, { ...env, FAKE_GH_PR: '9' });
    const comment = calls().find((c) => c.args[1] === 'comment')!;
    expect(comment.args[2]).toBe('9');
    expect(calls().some((c) => c.args[0] === 'api')).toBe(false);
  });
});

describe('runners', () => {
  it('ships presets and resolves ollama:<model>', () => {
    expect(listRunnerNames()).toEqual(
      expect.arrayContaining(['claude', 'codex', 'gemini', 'opencode', 'cursor']),
    );
    const ollama = resolveRunner('ollama:qwen2.5-coder:14b');
    expect(ollama.command).toBe('ollama');
    expect(ollama.headless.args.slice(0, 2)).toEqual(['run', 'qwen2.5-coder:14b']);
    expect(ollama.interactive).toBeNull();
    expect(() => resolveRunner('ollama:--evil')).toThrow(/Invalid ollama model/);
    expect(resolveRunner('cursor').headless.input).toBe('promptFileArg');
  });

  it('runs consensus reviewer passes in parallel (bounded by --concurrency)', () => {
    const { repo } = featureRepo('d2a-parallel-');
    const log = path.join(repo, 'runner.log');
    const env = { FAKE_RUNNER_SLEEP_MS: '600', FAKE_RUNNER_LOG: log };
    diff2ai(
      'review feature/ctx --target main --run fake --iterations 3 --concurrency 3',
      repo,
      env,
    );
    const spans = fs
      .readFileSync(log, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { kind: string; start: number; end: number })
      .filter((s) => s.kind === 'reviewer');
    expect(spans).toHaveLength(3);
    // all three reviewers overlap in time
    const latestStart = Math.max(...spans.map((s) => s.start));
    const earliestEnd = Math.min(...spans.map((s) => s.end));
    expect(latestStart).toBeLessThan(earliestEnd);
  });
});

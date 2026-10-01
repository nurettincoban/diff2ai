import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { suggestPersonas, topNPersonaSlugs, changedFiles } from '../src/orchestrator/signals.js';
import { buildDiffIndex, verifyFindings } from '../src/orchestrator/verify.js';
import { diffSummary, buildSelectionPrompt, parseSelection } from '../src/orchestrator/aiSelect.js';
import { BUILTIN_PERSONAS } from '../src/orchestrator/personas.js';
import { parseFindings } from '../src/formatters/findings.js';

function run(cmd: string, cwd: string, env: Record<string, string> = {}) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, ...env } });
}

const projectRoot = path.resolve(process.cwd());
const cli = path.join(projectRoot, 'dist', 'cli.js');
const fakeRunner = path.join(projectRoot, 'tests', 'fixtures', 'fake-runner.mjs');

function fakeDiff(files: { path: string; added: string[] }[]): string {
  return files
    .map(
      (f) =>
        `diff --git a/${f.path} b/${f.path}\nindex 000..111 100644\n--- a/${f.path}\n+++ b/${f.path}\n@@ -0,0 +1,${f.added.length} @@\n` +
        f.added.map((l) => `+${l}`).join('\n'),
    )
    .join('\n');
}

describe('persona signal suggestions', () => {
  it('always includes correctness and pads to at least two', () => {
    const s = suggestPersonas(fakeDiff([{ path: 'lib/util.js', added: ['const x = 1;'] }]));
    expect(s[0].slug).toBe('correctness');
    expect(s.length).toBeGreaterThanOrEqual(2);
  });

  it('suggests security for auth paths and secret-bearing content', () => {
    const byPath = suggestPersonas(fakeDiff([{ path: 'src/auth/login.ts', added: ['x'] }]));
    expect(
      byPath.some((s) => s.slug === 'security' && s.reason.includes('src/auth/login.ts')),
    ).toBe(true);
    const byContent = suggestPersonas(
      fakeDiff([{ path: 'src/thing.ts', added: ['const apiKey = "sk-123";'] }]),
    );
    expect(byContent.some((s) => s.slug === 'security')).toBe(true);
  });

  it('suggests testing when code changes lack test changes, not when tests accompany them', () => {
    const noTests = suggestPersonas(fakeDiff([{ path: 'src/a.ts', added: ['x'] }]));
    expect(noTests.some((s) => s.slug === 'testing-edge-cases')).toBe(true);
    const withTests = suggestPersonas(
      fakeDiff([
        { path: 'src/a.ts', added: ['x'] },
        { path: 'tests/a.test.ts', added: ['y'] },
      ]),
    );
    expect(withTests.some((s) => s.slug === 'testing-edge-cases')).toBe(false);
  });

  it('suggests api-maintainability for route/schema paths', () => {
    const s = suggestPersonas(fakeDiff([{ path: 'src/api/users.controller.ts', added: ['x'] }]));
    expect(s.some((x) => x.slug === 'api-maintainability')).toBe(true);
  });

  it('topNPersonaSlugs orders suggestions first and pads from the pool', () => {
    const suggestions = [
      { slug: 'correctness', reason: 'r' },
      { slug: 'security', reason: 'r' },
    ];
    const pool = ['correctness', 'security', 'performance', 'api-maintainability'];
    expect(topNPersonaSlugs(suggestions, 3, pool)).toEqual([
      'correctness',
      'security',
      'performance',
    ]);
    expect(topNPersonaSlugs(suggestions, 2, pool)).toEqual(['correctness', 'security']);
  });

  it('changedFiles extracts b-paths', () => {
    expect(changedFiles(fakeDiff([{ path: 'a/b.ts', added: ['x'] }]))).toEqual(['a/b.ts']);
  });
});

describe('AI persona selection units', () => {
  it('diffSummary reports per-file counts and caps the added-line sample', () => {
    const summary = diffSummary(
      fakeDiff([{ path: 'src/a.ts', added: Array.from({ length: 100 }, (_, i) => `line ${i}`) }]),
    );
    expect(summary).toContain('- src/a.ts (+100/-0)');
    // sample capped at 50 lines
    expect((summary.match(/^line \d+$/gm) ?? []).length).toBeLessThanOrEqual(50);
  });

  it('buildSelectionPrompt embeds the catalog and the output contract', () => {
    const prompt = buildSelectionPrompt(
      fakeDiff([{ path: 'a.ts', added: ['x'] }]),
      BUILTIN_PERSONAS,
    );
    expect(prompt).toContain('- correctness: Bug Hunter');
    expect(prompt).toContain('Output ONLY persona selections');
  });

  it('parseSelection validates slugs, dedupes, and rejects unusable output', () => {
    const parsed = parseSelection(
      'security: touches auth\n- correctness: logic risk\nsecurity: dup\nnope: invalid\nchatter line',
      BUILTIN_PERSONAS,
    );
    expect(parsed.map((s) => s.slug)).toEqual(['security', 'correctness']);
    expect(parseSelection('I think you should use all reviewers!', BUILTIN_PERSONAS)).toEqual([]);
  });
});

describe('post-judge verification', () => {
  const diff = fakeDiff([{ path: 'src/auth.js', added: ['line1', 'line2', 'line3'] }]);

  it('buildDiffIndex maps files to new-line hunk ranges', () => {
    const index = buildDiffIndex(diff);
    expect(index.get('src/auth.js')).toEqual([[1, 3]]);
  });

  it('verifies findings inside hunks; demotes wrong files, out-of-range lines, and missing refs', () => {
    const findings = parseFindings(
      [
        '## 1) Severity: HIGH | Type: Bug\nTitle: In range\n\nAffected:\n- src/auth.js:1-2\n',
        '## 2) Severity: HIGH | Type: Bug\nTitle: Wrong file\n\nAffected:\n- ghost.js:1-2\n',
        '## 3) Severity: LOW | Type: Style\nTitle: Out of range\n\nAffected:\n- src/auth.js:40-45\n',
        '## 4) Severity: LOW | Type: Style\nTitle: No reference\n',
      ].join('\n'),
    );
    const { verified, unverified } = verifyFindings(findings, diff);
    expect(verified.map((f) => f.title)).toEqual(['In range']);
    expect(unverified).toHaveLength(3);
    expect(unverified[0].reason).toMatch(/not part of the diff/);
    expect(unverified[1].reason).toMatch(/outside the changed hunks/);
    expect(unverified[2].reason).toMatch(/no Affected/);
  });

  it('tolerates path prefix differences (auth.js vs src/auth.js)', () => {
    const findings = parseFindings(
      '## 1) Severity: HIGH | Type: Bug\nTitle: Short path\n\nAffected:\n- auth.js:2\n',
    );
    expect(verifyFindings(findings, diff).verified).toHaveLength(1);
  });
});

describe('verification gate + auto personas integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  function makeRepo(prefix: string): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md && git commit -m init && git branch -M main', tmp);
    run('git checkout -b feature/sig', tmp);
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\nworld\nagain\n');
    fs.writeFileSync(path.join(tmp, 'auth.js'), 'const token = "secret";\n');
    run('git add . && git commit -m "feat: add files"', tmp);
    fs.writeFileSync(
      path.join(tmp, '.aidiff.json'),
      JSON.stringify({
        runners: {
          fake: {
            command: process.execPath,
            args: [fakeRunner],
            headless: { args: [], input: 'stdin' },
          },
        },
      }),
    );
    return tmp;
  }

  it('--personas auto asks the AI and uses its selection', () => {
    const tmp = makeRepo('diff2ai-auto-');
    const out = run(
      `node ${cli} review feature/sig --target main --run fake --personas auto 2>&1`,
      tmp,
    );
    expect(out).toMatch(/Reviewers selected by AI/);
    expect(out).toMatch(/Reviewer selection \(AI-selected\)/);
    expect(out).toMatch(/security — canned AI selection/);
    expect(out).toMatch(/Consensus review ready/);

    const reviewsDir = path.join(tmp, 'reviews');
    const runDir = fs.readdirSync(reviewsDir).find((f) => f.startsWith('run_'))!;
    const prompts = fs
      .readdirSync(path.join(reviewsDir, runDir))
      .filter((f) => /\.prompt\.md$/.test(f) && f.startsWith('iteration_'));
    expect(prompts).toEqual([
      'iteration_1_security.prompt.md',
      'iteration_2_correctness.prompt.md',
    ]);
  });

  it('--personas auto falls back to heuristics when the AI selection fails', () => {
    const tmp = makeRepo('diff2ai-auto-fallback-');
    const out = run(
      `node ${cli} review feature/sig --target main --run fake --personas auto 2>&1`,
      tmp,
      { FAKE_RUNNER_FAIL_MATCH: 'Output ONLY persona selections' },
    );
    expect(out).toMatch(/AI selection unavailable — using local heuristics/);
    expect(out).toMatch(/Reviewer selection \(from diff signals\)/);
    expect(out).toMatch(/security — touches auth\.js/);
    expect(out).toMatch(/testing-edge-cases — no test changes/);
    expect(out).toMatch(/Consensus review ready/);
  });

  it('demotes judge-hallucinated findings and post skips them', () => {
    const tmp = makeRepo('diff2ai-gate-');
    const out = run(
      `node ${cli} review feature/sig --target main --run fake --iterations 2 2>&1`,
      tmp,
      { FAKE_RUNNER_JUDGE_BOGUS: '1' },
    );
    expect(out).toMatch(/Local verification: 1\/2 finding\(s\) confirmed/);
    expect(out).toMatch(/unverified: 1 finding\(s\) demoted/);

    const reviewsDir = path.join(tmp, 'reviews');
    const runDir = fs.readdirSync(reviewsDir).find((f) => f.startsWith('run_'))!;
    const consolidated = fs.readFileSync(path.join(reviewsDir, runDir, 'consolidated.md'), 'utf-8');
    expect(consolidated).toMatch(/# ⚠ Unverified findings/);
    expect(consolidated).toMatch(/Verification: failed — ghost\.js is not part of the diff/);
    // verified finding stays above the unverified section
    expect(consolidated.indexOf('Shared finding')).toBeLessThan(
      consolidated.indexOf('Ghost finding'),
    );

    // post skips the unverified finding by default, includes it on request
    const dry = run(`node ${cli} --yes post reviews/${runDir}/consolidated.md --dry-run 2>&1`, tmp);
    expect(dry).toMatch(/Skipped 1 unverified finding/);
    expect(dry).toMatch(/Shared finding/);
    expect(dry).not.toMatch(/Ghost finding/);
    const dryAll = run(
      `node ${cli} --yes post reviews/${runDir}/consolidated.md --dry-run --include-unverified 2>&1`,
      tmp,
    );
    expect(dryAll).toMatch(/Ghost finding/);
  });

  it('keeps consolidated.md untouched when everything verifies', () => {
    const tmp = makeRepo('diff2ai-gate-clean-');
    const out = run(
      `node ${cli} review feature/sig --target main --run fake --iterations 2 2>&1`,
      tmp,
    );
    expect(out).toMatch(/Local verification: 1\/1 finding\(s\) confirmed/);
    expect(out).not.toMatch(/demoted/);
    const reviewsDir = path.join(tmp, 'reviews');
    const runDir = fs.readdirSync(reviewsDir).find((f) => f.startsWith('run_'))!;
    const consolidated = fs.readFileSync(path.join(reviewsDir, runDir, 'consolidated.md'), 'utf-8');
    expect(consolidated).not.toMatch(/Unverified findings/);
  });
});

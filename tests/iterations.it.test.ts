import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  selectPersonas,
  personasBySlugs,
  wrapWithPersona,
  BUILTIN_PERSONAS,
} from '../src/orchestrator/personas.js';
import { buildJudgePrompt, isValidJudgeOutput } from '../src/orchestrator/judge.js';
import { estimateConsensusTokens } from '../src/orchestrator/estimate.js';
import { resolveRunner, listRunnerNames } from '../src/runners/resolve.js';

function run(cmd: string, cwd: string, env: Record<string, string> = {}) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, ...env } });
}

const projectRoot = path.resolve(process.cwd());
const cli = path.join(projectRoot, 'dist', 'cli.js');
const fakeRunner = path.join(projectRoot, 'tests', 'fixtures', 'fake-runner.mjs');

function makeRepoWithBranch(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  run('git init', tmp);
  fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
  run('git add README.md', tmp);
  run('git commit -m "init"', tmp);
  run('git branch -M main', tmp);
  run('git checkout -b feature/iter', tmp);
  fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\nworld\nagain\n');
  run('git add file.txt', tmp);
  run('git commit -m "feat: add file"', tmp);
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

function runDirOf(tmp: string): string {
  const reviewsDir = path.join(tmp, 'reviews');
  const runDir = fs.readdirSync(reviewsDir).find((f) => f.startsWith('run_'))!;
  expect(runDir).toBeTruthy();
  return path.join(reviewsDir, runDir);
}

describe('review --iterations integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  it('runs N persona passes, judges them, and writes a consolidated review', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-');
    const out = run(
      `node ${cli} review feature/iter --target main --run fake --iterations 3 2>&1`,
      tmp,
    );
    expect(out).toMatch(/Consensus review ready/);

    const runDir = runDirOf(tmp);
    const files = fs.readdirSync(runDir).sort();

    // base prompt + 3 iteration prompt/response pairs + judge prompt + consolidated
    expect(files).toContain('prompt.md');
    expect(files).toContain('judge.prompt.md');
    expect(files).toContain('consolidated.md');
    const prompts = files.filter((f) => /^iteration_\d+_.*\.prompt\.md$/.test(f));
    const responses = files.filter((f) => /^iteration_\d+_.*\.response\.md$/.test(f));
    expect(prompts).toHaveLength(3);
    expect(responses).toHaveLength(3);

    // distinct persona slugs, signal-suggested first (code-only diff with no
    // test changes → correctness + testing, padded with security)
    expect(prompts).toEqual([
      'iteration_1_correctness.prompt.md',
      'iteration_2_testing-edge-cases.prompt.md',
      'iteration_3_security.prompt.md',
    ]);

    // each iteration prompt = persona header + full base prompt (incl. diff)
    const basePrompt = fs.readFileSync(path.join(runDir, 'prompt.md'), 'utf-8');
    for (const p of prompts) {
      const content = fs.readFileSync(path.join(runDir, p), 'utf-8');
      expect(content).toMatch(/^# Reviewer Persona: /);
      expect(content.endsWith(basePrompt)).toBe(true);
      expect(content).toMatch(/diff --git/);
    }

    // judge prompt contains the raw diff and exactly 3 review sections
    const judgePrompt = fs.readFileSync(path.join(runDir, 'judge.prompt.md'), 'utf-8');
    expect(judgePrompt).toMatch(/--- START DIFF ---/);
    expect(judgePrompt).toMatch(/diff --git/);
    expect(judgePrompt.match(/^--- REVIEW \d+ \(persona: /gm)).toHaveLength(3);

    // consolidated review has full consensus (fake judge counts review sections)
    const consolidated = fs.readFileSync(path.join(runDir, 'consolidated.md'), 'utf-8');
    expect(consolidated).toMatch(/Consensus: 3\/3 reviewers/);
    expect(consolidated).toMatch(/judge saw diff: true/);
  });

  it('continues when one pass fails and notes it in the consolidated output', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-onefail-');
    const out = run(
      `node ${cli} review feature/iter --target main --run fake --iterations 3 2>&1`,
      tmp,
      { FAKE_RUNNER_FAIL_MATCH: 'Reviewer Persona: Security Auditor' },
    );
    expect(out).toMatch(/Security Auditor failed/);
    expect(out).toMatch(/Consensus review ready/);
    expect(out).toMatch(/2\/3 succeeded/);

    const runDir = runDirOf(tmp);
    const judgePrompt = fs.readFileSync(path.join(runDir, 'judge.prompt.md'), 'utf-8');
    expect(judgePrompt.match(/^--- REVIEW \d+ \(persona: /gm)).toHaveLength(2);
    const consolidated = fs.readFileSync(path.join(runDir, 'consolidated.md'), 'utf-8');
    expect(consolidated).toMatch(/1 reviewer pass\(es\) failed \(Security Auditor\)/);
    expect(consolidated).toMatch(/Consensus: 2\/2 reviewers/);
  });

  it('fails when fewer than 2 passes succeed, keeping surviving artifacts', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-mostfail-');
    let failed = false;
    try {
      run(`node ${cli} review feature/iter --target main --run fake --iterations 3 2>&1`, tmp, {
        FAKE_RUNNER_FAIL_MATCH: 'Persona: (Security Auditor|Test Engineer)',
      });
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/Only 1 of 3 reviewer passes succeeded/);
    }
    expect(failed).toBe(true);
    const runDir = runDirOf(tmp);
    const files = fs.readdirSync(runDir);
    expect(files).toContain('iteration_1_correctness.response.md');
    expect(files).not.toContain('consolidated.md');
  });

  it('fails with guidance when the judge pass fails, keeping judge.prompt.md', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-judgefail-');
    let failed = false;
    try {
      run(`node ${cli} review feature/iter --target main --run fake --iterations 2 2>&1`, tmp, {
        FAKE_RUNNER_FAIL_MATCH: 'Consolidation and Validation',
      });
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/Judge pass failed/);
      expect(out).toMatch(/judge\.prompt\.md/);
    }
    expect(failed).toBe(true);
    const runDir = runDirOf(tmp);
    expect(fs.readdirSync(runDir)).toContain('judge.prompt.md');
  });

  it('rejects --iterations without --run before any diff work', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-norun-');
    let failed = false;
    try {
      run(`node ${cli} review feature/iter --target main --iterations 3 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/--iterations\/--personas require --run/);
    }
    expect(failed).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'reviews'))).toBe(false);
  });

  it('prints a token estimate before running', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-estimate-');
    const out = run(
      `node ${cli} review feature/iter --target main --run fake --iterations 2 2>&1`,
      tmp,
    );
    expect(out).toMatch(/Estimated cost: 3 AI calls \(2 reviewers \+ judge\)/);
    expect(out).toMatch(/input tokens/);
  });

  it('honors an explicit --personas selection (order kept, --iterations ignored)', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-personas-');
    const out = run(
      `node ${cli} review feature/iter --target main --run fake --personas testing-edge-cases,security --iterations 4 2>&1`,
      tmp,
    );
    expect(out).toMatch(/ignoring --iterations 4/);
    expect(out).toMatch(/Consensus review ready/);
    const runDir = runDirOf(tmp);
    const prompts = fs
      .readdirSync(runDir)
      .filter((f) => /^iteration_\d+_.*\.prompt\.md$/.test(f))
      .sort();
    expect(prompts).toEqual([
      'iteration_1_testing-edge-cases.prompt.md',
      'iteration_2_security.prompt.md',
    ]);
  });

  it('rejects unknown and too-few personas', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-badpersona-');
    let failed = false;
    try {
      run(
        `node ${cli} review feature/iter --target main --run fake --personas nope,security 2>&1`,
        tmp,
      );
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/Unknown persona "nope"/);
      expect(out).toMatch(/correctness/);
    }
    expect(failed).toBe(true);

    failed = false;
    try {
      run(`node ${cli} review feature/iter --target main --run fake --personas security 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/at least 2 reviewer personas/);
    }
    expect(failed).toBe(true);
  });

  it('rejects invalid --then values', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-then-');
    let failed = false;
    try {
      run(
        `node ${cli} review feature/iter --target main --run fake --iterations 2 --then yolo 2>&1`,
        tmp,
      );
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/--then must be one of: fix, comment, none/);
    }
    expect(failed).toBe(true);
    // valid value passes through (non-TTY: no chat is launched anyway)
    const out = run(
      `node ${cli} review feature/iter --target main --run fake --iterations 2 --then comment 2>&1`,
      tmp,
    );
    expect(out).toMatch(/Consensus review ready/);
  });

  it('rejects invalid iteration counts', () => {
    const tmp = makeRepoWithBranch('diff2ai-iter-invalid-');
    for (const bad of ['1', '0', 'abc']) {
      let failed = false;
      try {
        run(
          `node ${cli} review feature/iter --target main --run fake --iterations ${bad} 2>&1`,
          tmp,
        );
      } catch (e: unknown) {
        failed = true;
        const out =
          String((e as { stdout?: string }).stdout ?? '') +
          String((e as { stderr?: string }).stderr ?? '');
        expect(out).toMatch(/--iterations must be an integer >= 2/);
      }
      expect(failed).toBe(true);
    }
  });
});

describe('orchestrator units', () => {
  it('selectPersonas returns distinct built-ins and honors config extensions', () => {
    expect(selectPersonas(5).map((p) => p.slug)).toEqual([
      'correctness',
      'security',
      'performance',
      'api-maintainability',
      'testing-edge-cases',
    ]);
    const extended = selectPersonas(6, { Concurrency: 'Focus on race conditions.' });
    expect(extended[5]).toMatchObject({ slug: 'concurrency', name: 'Concurrency' });
    expect(() => selectPersonas(6)).toThrow(/exceeds the available reviewer personas/);
    // config can override a built-in by slug without growing the pool
    const overridden = selectPersonas(5, { security: 'Custom security brief.' });
    expect(overridden[1].instructions).toBe('Custom security brief.');
    expect(overridden).toHaveLength(5);
  });

  it('wrapWithPersona preserves the rendered prompt verbatim as a suffix', () => {
    const rendered = 'INSTRUCTIONS\n\n```diff\n+ x\n```\n';
    const wrapped = wrapWithPersona(rendered, BUILTIN_PERSONAS[0]);
    expect(wrapped.endsWith(rendered)).toBe(true);
    expect(wrapped).toMatch(/^# Reviewer Persona: Bug Hunter/);
  });

  it('buildJudgePrompt embeds diff and reviews; isValidJudgeOutput filters chatter', () => {
    const prompt = buildJudgePrompt('diff --git a/x b/x', [
      { persona: BUILTIN_PERSONAS[0], output: 'review one' },
      { persona: BUILTIN_PERSONAS[1], output: 'review two' },
    ]);
    expect(prompt).toContain('--- START DIFF ---\ndiff --git a/x b/x\n--- END DIFF ---');
    expect(prompt).toContain('--- REVIEW 1 (persona: Bug Hunter) ---');
    expect(prompt).toContain('--- REVIEW 2 (persona: Security Auditor) ---');
    expect(isValidJudgeOutput('## 1) Severity: HIGH | Type: Bug\nTitle: x')).toBe(true);
    expect(isValidJudgeOutput('No validated issues.')).toBe(true);
    expect(isValidJudgeOutput('Sure! Here is my analysis...')).toBe(false);
    expect(isValidJudgeOutput('')).toBe(false);
  });

  it('personasBySlugs rejects duplicates and keeps order', () => {
    const picked = personasBySlugs(['security', 'correctness']);
    expect(picked.map((p) => p.slug)).toEqual(['security', 'correctness']);
    expect(() => personasBySlugs(['security', 'security'])).toThrow(/Duplicate persona/);
  });

  it('estimateConsensusTokens scales with reviewers and prompt size', () => {
    const est = estimateConsensusTokens('x'.repeat(4000), 'y'.repeat(2000), 3);
    expect(est.calls).toBe(4);
    // 3 × (~1000 + header) + judge (~700 + 500 + 3×800)
    expect(est.inputTokens).toBeGreaterThan(3 * 1000);
    expect(
      estimateConsensusTokens('x'.repeat(4000), 'y'.repeat(2000), 5).inputTokens,
    ).toBeGreaterThan(est.inputTokens);
  });

  it('resolveRunner merges config over built-ins and validates', () => {
    expect(listRunnerNames()).toContain('claude');
    const fake = resolveRunner('fake', {
      fake: { command: 'node', headless: { args: ['x'], input: 'stdin' } },
    });
    expect(fake).toMatchObject({
      command: 'node',
      headless: { args: ['x'], input: 'stdin' },
      timeoutMs: 600_000,
    });
    // config can override the built-in claude
    const overridden = resolveRunner('claude', { claude: { command: 'claude-next' } });
    expect(overridden.command).toBe('claude-next');
    expect(() => resolveRunner('nope')).toThrow(/Unknown runner "nope"/);
    expect(() => resolveRunner('bad', { bad: { command: ' ' } })).toThrow(/non-empty string/);
  });
});

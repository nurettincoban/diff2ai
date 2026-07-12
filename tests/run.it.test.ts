import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

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
  run('git checkout -b feature/run', tmp);
  fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\nworld\nagain\n');
  run('git add file.txt', tmp);
  run('git commit -m "feat: add file"', tmp);
  writeFakeRunnerConfig(tmp);
  return tmp;
}

function writeFakeRunnerConfig(tmp: string, extra: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(tmp, '.aidiff.json'),
    JSON.stringify({
      runners: {
        fake: {
          command: process.execPath,
          args: [fakeRunner],
          headless: { args: [], input: 'stdin' },
          interactive: { args: ['{promptFileInstruction}'] },
        },
      },
      ...extra,
    }),
  );
}

describe('review --run integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  it('runs headless in non-TTY and saves the response next to the prompt', () => {
    const tmp = makeRepoWithBranch('diff2ai-run-');
    const out = run(`node ${cli} review feature/run --target main --run fake 2>&1`, tmp);
    expect(out).toMatch(/not a TTY/i);
    expect(out).toMatch(/AI review saved/);

    const reviewsDir = path.join(tmp, 'reviews');
    const files = fs.readdirSync(reviewsDir);
    const response = files.find((f) => f.endsWith('.response.md'))!;
    expect(response).toBeTruthy();
    const content = fs.readFileSync(path.join(reviewsDir, response), 'utf-8');
    expect(content).toMatch(/Shared finding/);
    // No persona header in single-run mode
    expect(content).toMatch(/Unique to No Persona/);
  });

  it('still writes the prompt file when --copy is combined with --run', () => {
    const tmp = makeRepoWithBranch('diff2ai-run-copy-');
    run(`node ${cli} review feature/run --target main --run fake --copy 2>&1`, tmp);
    const reviewsDir = path.join(tmp, 'reviews');
    const files = fs.readdirSync(reviewsDir);
    expect(files.some((f) => f.endsWith('.md') && !f.endsWith('.response.md'))).toBe(true);
  });

  it('errors up front for an unknown runner, listing available ones', () => {
    const tmp = makeRepoWithBranch('diff2ai-run-unknown-');
    let failed = false;
    try {
      run(`node ${cli} review feature/run --target main --run nope 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string; stderr?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/Unknown runner "nope"/);
      expect(out).toMatch(/claude/);
      expect(out).toMatch(/fake/);
    }
    expect(failed).toBe(true);
    // failed before generating anything
    expect(fs.existsSync(path.join(tmp, 'reviews'))).toBe(false);
  });

  it('surfaces runner failure with a non-zero exit', () => {
    const tmp = makeRepoWithBranch('diff2ai-run-fail-');
    let failed = false;
    try {
      run(`node ${cli} review feature/run --target main --run fake 2>&1`, tmp, {
        FAKE_RUNNER_FAIL_MATCH: '.',
      });
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/exited with code 1/);
    }
    expect(failed).toBe(true);
  });

  it('refuses --run when the diff exceeds the profile budget', () => {
    const tmp = makeRepoWithBranch('diff2ai-run-big-');
    // add a large change so approxTokens > generic-medium budget (30k tokens ≈ 120k chars)
    const big = Array.from({ length: 4000 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    fs.writeFileSync(path.join(tmp, 'big.txt'), big);
    run('git add big.txt', tmp);
    run('git commit -m "big"', tmp);
    let failed = false;
    try {
      run(`node ${cli} review feature/run --target main --run fake 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/exceeds the "generic-medium" profile budget/);
      expect(out).toMatch(/--profile claude-large/);
    }
    expect(failed).toBe(true);
  });
});

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { buildReviewArgs } from '../src/commands/interactive.js';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

const projectRoot = path.resolve(process.cwd());
const cli = path.join(projectRoot, 'dist', 'cli.js');

describe('interactive command', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  it('refuses to run without a TTY, pointing at review flags', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-interactive-'));
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'x\n');
    run('git add a.txt && git commit -m init', tmp);
    let failed = false;
    try {
      run(`node ${cli} interactive 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/needs a terminal/);
      expect(out).toMatch(/diff2ai review/);
    }
    expect(failed).toBe(true);
  });

  it('is registered with the i alias', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-interactive-help-'));
    const out = run(`node ${cli} --help 2>&1`, tmp);
    expect(out).toMatch(/interactive\|i/);
  });
});

describe('buildReviewArgs unit', () => {
  it('prompt-only mode with optional copy', () => {
    expect(buildReviewArgs({ ref: 'feat', target: 'main', mode: 'prompt' })).toEqual([
      'review',
      'feat',
      '--target',
      'main',
    ]);
    expect(buildReviewArgs({ ref: 'feat', target: 'main', mode: 'prompt', copy: true })).toContain(
      '--copy',
    );
  });

  it('single AI mode adds --run', () => {
    expect(
      buildReviewArgs({ ref: 'feat', target: 'develop', mode: 'single', runner: 'claude' }),
    ).toEqual(['review', 'feat', '--target', 'develop', '--run', 'claude']);
  });

  it('consensus mode adds personas and then-action', () => {
    expect(
      buildReviewArgs({
        ref: 'feat',
        target: 'main',
        mode: 'consensus',
        runner: 'claude',
        personas: ['correctness', 'security'],
        then: 'comment',
      }),
    ).toEqual([
      'review',
      'feat',
      '--target',
      'main',
      '--run',
      'claude',
      '--personas',
      'correctness,security',
      '--then',
      'comment',
    ]);
  });
});

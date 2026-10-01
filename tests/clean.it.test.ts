import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

const projectRoot = path.resolve(process.cwd());
const cli = path.join(projectRoot, 'dist', 'cli.js');

function makeArtifacts(prefix: string): { tmp: string; reviews: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const reviews = path.join(tmp, 'reviews');
  fs.mkdirSync(path.join(reviews, 'run_2026-01-01_00-00-00-000'), { recursive: true });
  fs.writeFileSync(path.join(reviews, 'run_2026-01-01_00-00-00-000', 'consolidated.md'), 'old');
  fs.mkdirSync(path.join(reviews, 'run_2026-02-02_00-00-00-000'), { recursive: true });
  fs.writeFileSync(path.join(reviews, 'run_2026-02-02_00-00-00-000', 'consolidated.md'), 'new');
  fs.writeFileSync(path.join(reviews, 'review_2026-01-01_00-00-00-000.md'), 'prompt');
  fs.writeFileSync(path.join(reviews, 'staged_2026-01-01_00-00-00-000.diff'), 'diff');
  fs.writeFileSync(path.join(reviews, 'batch_1.md'), 'batch');
  fs.writeFileSync(path.join(reviews, 'review_index.md'), 'index');
  fs.writeFileSync(path.join(reviews, 'review_2026-01-01.response.md'), 'response');
  fs.writeFileSync(path.join(reviews, 'my-notes.md'), 'user file, keep!');
  // make the newer run dir actually newer by mtime
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(reviews, 'run_2026-01-01_00-00-00-000'), past, past);
  return { tmp, reviews };
}

describe('clean integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  it('--dry-run lists artifacts without deleting, ignoring user files', () => {
    const { tmp, reviews } = makeArtifacts('diff2ai-clean-dry-');
    const out = run(`node ${cli} clean --dry-run 2>&1`, tmp);
    expect(out).toMatch(/7 artifact\(s\)/);
    expect(out).toMatch(/run_2026-01-01_00-00-00-000\//);
    expect(out).toMatch(/batch_1\.md/);
    expect(out).not.toMatch(/my-notes\.md/);
    expect(out).toMatch(/nothing was deleted/);
    expect(fs.readdirSync(reviews)).toHaveLength(8);
  });

  it('deletes artifacts with --yes, keeps user files and the directory', () => {
    const { tmp, reviews } = makeArtifacts('diff2ai-clean-yes-');
    const out = run(`node ${cli} --yes clean 2>&1`, tmp);
    expect(out).toMatch(/Cleaned/);
    expect(out).toMatch(/2 run dir\(s\), 5 file\(s\)/);
    expect(fs.readdirSync(reviews)).toEqual(['my-notes.md']);
  });

  it('--keep 1 keeps the newest run dir and newest loose artifact', () => {
    const { tmp, reviews } = makeArtifacts('diff2ai-clean-keep-');
    run(`node ${cli} --yes clean --keep 1 2>&1`, tmp);
    const left = fs.readdirSync(reviews);
    expect(left).toContain('run_2026-02-02_00-00-00-000');
    expect(left).not.toContain('run_2026-01-01_00-00-00-000');
    expect(left).toContain('my-notes.md');
    // exactly one loose artifact kept
    expect(left.filter((f) => f !== 'my-notes.md' && !f.startsWith('run_'))).toHaveLength(1);
  });

  it('refuses to delete without --yes in non-interactive mode', () => {
    const { tmp, reviews } = makeArtifacts('diff2ai-clean-noyes-');
    let failed = false;
    try {
      run(`node ${cli} clean 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/requires confirmation/);
    }
    expect(failed).toBe(true);
    expect(fs.readdirSync(reviews)).toHaveLength(8);
  });

  it('handles a missing output directory gracefully', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-clean-none-'));
    const out = run(`node ${cli} clean --dry-run 2>&1`, tmp);
    expect(out).toMatch(/Nothing to clean/);
  });
});

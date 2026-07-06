import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('review integration', () => {
  const projectRoot = path.resolve(process.cwd());
  const cli = path.join(projectRoot, 'dist', 'cli.js');

  beforeAll(() => {
    if (!fs.existsSync(cli)) {
      run('npm run -s build', projectRoot);
    }
  });
  it('writes only .md by default and .diff when --save-diff is used', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-'));

    // init repo and main branch
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    // create bare remote and push main so origin/main exists
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-'));
    run('git init --bare', remote);
    run(`git remote add origin ${remote}`, tmp);
    run('git push -u origin main', tmp);

    // create a commit on a feature branch
    run('git checkout -b feature/test', tmp);
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\n');
    run('git add file.txt', tmp);
    run('git commit -m "feat: add file"', tmp);

    // default: md only
    const out1 = run(`node ${cli} review feature/test --target main`, tmp);
    expect(out1).toMatch(/Review prompt ready/);
    const reviewsDir = path.join(tmp, 'reviews');
    const files1 = fs.readdirSync(reviewsDir);
    expect(files1.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files1.some((f) => f.endsWith('.diff'))).toBe(false);

    // with --save-diff: md + diff
    const out2 = run(`node ${cli} review feature/test --target main --save-diff`, tmp);
    expect(out2).toMatch(/diff:\s+/);
    const files2 = fs.readdirSync(reviewsDir);
    expect(files2.some((f) => f.endsWith('.md'))).toBe(true);
    expect(files2.some((f) => f.endsWith('.diff'))).toBe(true);
  });

  it('switches to the ref when --switch is provided and leaves repo on that branch', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-switch-'));

    // init repo and main branch
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    // create bare remote and push main
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-'));
    run('git init --bare', remote);
    run(`git remote add origin ${remote}`, tmp);
    run('git push -u origin main', tmp);

    // create a commit on a feature branch
    run('git checkout -b feature/switch', tmp);
    fs.writeFileSync(path.join(tmp, 'f.txt'), 'x\n');
    run('git add f.txt', tmp);
    run('git commit -m "feat: add f"', tmp);

    // go back to main to force an actual switch
    run('git checkout main', tmp);

    run(`node ${cli} review feature/switch --target main --switch`, tmp);

    const head = run('git rev-parse --abbrev-ref HEAD', tmp).trim();
    expect(head).toBe('feature/switch');
  });

  it('refuses to switch when dirty/untracked unless --yes is provided', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-preflight-'));

    // init repo and main branch
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    // create bare remote and push main
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-'));
    run('git init --bare', remote);
    run(`git remote add origin ${remote}`, tmp);
    run('git push -u origin main', tmp);

    // create feature branch and commit
    run('git checkout -b feature/pre', tmp);
    fs.writeFileSync(path.join(tmp, 'p.txt'), '1\n');
    run('git add p.txt', tmp);
    run('git commit -m "feat: add p"', tmp);

    // back to main, add an untracked file
    run('git checkout main', tmp);
    fs.writeFileSync(path.join(tmp, 'untracked.txt'), 'u\n');

    // Without --yes: should refuse and not create reviews dir, and stay on main
    run(`node ${cli} review feature/pre --target main --switch`, tmp);
    const head1 = run('git rev-parse --abbrev-ref HEAD', tmp).trim();
    expect(head1).toBe('main');
    const reviewsDir1 = path.join(tmp, 'reviews');
    expect(fs.existsSync(reviewsDir1)).toBe(false);

    // With --yes: proceed, switch and write output
    run(`node ${cli} --yes review feature/pre --target main --switch`, tmp);
    const head2 = run('git rev-parse --abbrev-ref HEAD', tmp).trim();
    expect(head2).toBe('feature/pre');
    const reviewsDir2 = path.join(tmp, 'reviews');
    expect(fs.existsSync(reviewsDir2)).toBe(true);
    const files = fs.readdirSync(reviewsDir2);
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('--copy alone skips the prompt file; --copy --save-diff still writes it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-copy-'));

    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    run('git checkout -b feature/copy', tmp);
    fs.writeFileSync(path.join(tmp, 'c.txt'), 'copy\n');
    run('git add c.txt', tmp);
    run('git commit -m "feat: add c"', tmp);

    // copy-only: no reviews/ output (unless clipboard failed and it fell back)
    const out1 = run(`node ${cli} review feature/copy --target main --copy 2>&1`, tmp);
    expect(out1).toMatch(/Review prompt ready/);
    const reviewsDir = path.join(tmp, 'reviews');
    if (out1.includes('Failed to copy')) {
      // headless environment: fallback file is expected instead
      expect(fs.readdirSync(reviewsDir).some((f) => f.endsWith('.md'))).toBe(true);
    } else {
      expect(out1).toMatch(/clipboard only/);
      expect(fs.existsSync(reviewsDir)).toBe(false);
    }

    // --copy with --save-diff keeps writing both files
    run(`node ${cli} review feature/copy --target main --copy --save-diff 2>&1`, tmp);
    const files = fs.readdirSync(reviewsDir);
    expect(files.some((f) => f.endsWith('.diff'))).toBe(true);
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('works in a repo with no origin remote (falls back to local target)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-local-'));

    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    run('git checkout -b feature/local', tmp);
    fs.writeFileSync(path.join(tmp, 'local.txt'), 'local\n');
    run('git add local.txt', tmp);
    run('git commit -m "feat: local"', tmp);

    const out = run(`node ${cli} review feature/local --target main`, tmp);
    expect(out).toMatch(/Review prompt ready/);
    const files = fs.readdirSync(path.join(tmp, 'reviews'));
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('errors clearly when the target branch does not exist anywhere', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-notarget-'));
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    const out = run(`node ${cli} review main --target does-not-exist 2>&1 || true`, tmp);
    expect(out).toMatch(/Target "does-not-exist" not found/);
  });

  it('auto-chunks the prompt when the diff exceeds the profile budget', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-chunk-'));

    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    // large diff: several files well past the generic-medium budget (~120k chars)
    run('git checkout -b feature/big', tmp);
    for (let i = 0; i < 4; i++) {
      const lines = Array.from({ length: 800 }, (_, n) => `line ${n} ${'x'.repeat(60)}`);
      fs.writeFileSync(path.join(tmp, `big_${i}.txt`), lines.join('\n') + '\n');
    }
    run('git add .', tmp);
    run('git commit -m "feat: big files"', tmp);

    const out = run(`node ${cli} review feature/big --target main --profile generic-medium`, tmp);
    expect(out).toMatch(/Review prompt ready/);
    const files = fs.readdirSync(path.join(tmp, 'reviews'));
    expect(files.filter((f) => /^batch_\d+\.md$/.test(f)).length).toBeGreaterThan(1);
    expect(files).toContain('review_index.md');

    // each batch is wrapped in the template and carries file headers
    const batch1 = fs.readFileSync(path.join(tmp, 'reviews', 'batch_1.md'), 'utf-8');
    expect(batch1).toMatch(/diff --git a\/big_0\.txt/);
  });

  it('fetches origin/<target> when --fetch is provided', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-review-fetch-'));

    // init repo and main branch
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);

    // create bare remote and push main
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-'));
    run('git init --bare', remote);
    run(`git remote add origin ${remote}`, tmp);
    run('git push -u origin main', tmp);

    // create a feature branch locally
    run('git checkout -b feature/fetch', tmp);
    fs.writeFileSync(path.join(tmp, 'z.txt'), 'z\n');
    run('git add z.txt', tmp);
    run('git commit -m "feat: add z"', tmp);

    // simulate new commit on remote main (without fetching locally yet)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-work-'));
    run(`git clone ${remote} .`, work);
    fs.writeFileSync(path.join(work, 'R.md'), 'remote\n');
    run('git add R.md', work);
    run('git commit -m "chore: remote update"', work);
    run('git push origin main', work);

    // Get old remote-tracking SHA in local repo
    const beforeSha = run('git rev-parse origin/main', tmp).trim();

    // Run review with --fetch to update origin/main
    run(`node ${cli} review feature/fetch --target main --fetch`, tmp);

    const afterSha = run('git rev-parse origin/main', tmp).trim();
    expect(afterSha).not.toBe(beforeSha);
  });
});

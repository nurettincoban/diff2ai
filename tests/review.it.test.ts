import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('review integration', () => {
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

    const projectRoot = path.resolve(process.cwd());
    const cli = path.join(projectRoot, 'dist', 'cli.js');
    run('npm run -s build', projectRoot);

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
});



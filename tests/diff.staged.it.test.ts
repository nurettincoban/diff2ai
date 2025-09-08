import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('diff --staged integration', () => {
  it('creates a diff file with content for staged changes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-it-'));

    // init repo
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'README.md'), '# temp\n');
    run('git add README.md', tmp);
    run('git commit -m "init"', tmp);

    // staged change
    fs.writeFileSync(path.join(tmp, 'file.txt'), 'hello\n');
    run('git add file.txt', tmp);

    // resolve project root and CLI path
    const projectRoot = path.resolve(process.cwd());
    const cli = path.join(projectRoot, 'dist', 'cli.js');

    // build before running
    run('npm run -s build', projectRoot);

    const out = run(`node ${cli} diff --staged`, tmp);
    expect(out).toMatch(/Wrote diff:/);

    const reviewsDir = path.join(tmp, 'reviews');
    const written = fs
      .readdirSync(reviewsDir)
      .filter((f) => f.endsWith('.diff'))
      .map((f) => path.join(reviewsDir, f));

    expect(written.length).toBeGreaterThan(0);
    const diffContent = fs.readFileSync(written[0], 'utf-8');
    expect(diffContent.length).toBeGreaterThan(0);
    expect(diffContent).toMatch(/\+hello/);
  });
});

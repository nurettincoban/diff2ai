import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
    const projectRoot = path.resolve(__dirname, '..');
    const cli = path.join(projectRoot, 'dist', 'cli.js');

    // build before running
    run('npm run -s build', projectRoot);

    const out = run(`node ${cli} diff --staged`, tmp);
    expect(out).toMatch(/Wrote diff:/);

    const written = fs
      .readdirSync(tmp)
      .filter((f) => f.endsWith('.diff'))
      .map((f) => path.join(tmp, f));

    expect(written.length).toBeGreaterThan(0);
    const diffContent = fs.readFileSync(written[0], 'utf-8');
    expect(diffContent.length).toBeGreaterThan(0);
    expect(diffContent).toMatch(/\+hello/);
  });
});

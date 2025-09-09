import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('show integration', () => {
  it('writes a diff for a specific commit', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-show-'));
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\n');
    run('git add a.txt', tmp);
    run('git commit -m "a"', tmp);
    fs.writeFileSync(path.join(tmp, 'a.txt'), 'one\ntwo\n');
    run('git add a.txt', tmp);
    run('git commit -m "b"', tmp);
    const sha = run('git rev-parse HEAD', tmp).trim();

    const projectRoot = path.resolve(process.cwd());
    const cli = path.join(projectRoot, 'dist', 'cli.js');
    run('npm run -s build', projectRoot);

    const out = run(`node ${cli} show ${sha}`, tmp);
    expect(out).toMatch(/Wrote diff:/);
    const files = fs.readdirSync(path.join(tmp, 'reviews')).filter((f) => f.endsWith('.diff'));
    expect(files.length).toBeGreaterThan(0);
  });
});

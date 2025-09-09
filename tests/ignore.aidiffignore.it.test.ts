import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('.aidiffignore integration', () => {
  it('excludes files matching ignore patterns from the generated diff', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-ignore-'));

    // init repo and remote main
    run('git init', tmp);
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'keep\n');
    fs.writeFileSync(path.join(tmp, 'ignore.log'), 'log\n');
    run('git add keep.txt ignore.log', tmp);
    run('git commit -m "init"', tmp);
    run('git branch -M main', tmp);
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-remote-'));
    run('git init --bare', remote);
    run(`git remote add origin ${remote}`, tmp);
    run('git push -u origin main', tmp);

    // change both files and commit so diff origin/main...HEAD includes them
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'keep\nchange\n');
    fs.writeFileSync(path.join(tmp, 'ignore.log'), 'log\nchange\n');
    run('git add .', tmp);
    run('git commit -m "change"', tmp);

    // write .aidiffignore to exclude *.log
    fs.writeFileSync(path.join(tmp, '.aidiffignore'), '*.log\n');

    const projectRoot = path.resolve(process.cwd());
    const cli = path.join(projectRoot, 'dist', 'cli.js');
    run('npm run -s build', projectRoot);

    // run diff against origin/main...HEAD (default of diff command)
    const out = run(`node ${cli} diff --no-interactive --yes`, tmp);
    expect(out).toMatch(/Wrote diff:/);

    const reviewsDir = path.join(tmp, 'reviews');
    const diffFile = fs.readdirSync(reviewsDir).find((f) => f.endsWith('.diff'))!;
    const content = fs.readFileSync(path.join(reviewsDir, diffFile), 'utf-8');

    expect(content).toMatch(/keep.txt/);
    expect(content).not.toMatch(/ignore.log/);
  });
});



import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

function run(cmd: string, cwd: string) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' });
}

describe('chunk integration', () => {
  const projectRoot = path.resolve(process.cwd());
  const cli = path.join(projectRoot, 'dist', 'cli.js');

  beforeAll(() => {
    if (!fs.existsSync(cli)) {
      run('npm run -s build', projectRoot);
    }
  });
  it('writes batch files and index', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diff2ai-chunk-'));
    // Create a simple diff file
    const diffPath = path.join(tmp, 'sample.diff');
    const content = Array.from({ length: 200 }, (_, i) => `+ line ${i}`).join('\n');
    fs.writeFileSync(diffPath, `diff --git a/a b/a\n${content}\n`);

    

    const out = run(`node ${cli} chunk ${diffPath} --profile generic-medium`, tmp);
    expect(out).toMatch(/Chunking complete/);
    const reviewsDir = path.join(tmp, 'reviews');
    const files = fs.readdirSync(reviewsDir);
    expect(files.some((f) => f.startsWith('batch_') && f.endsWith('.md'))).toBe(true);
    expect(files.includes('review_index.md')).toBe(true);
  });
});

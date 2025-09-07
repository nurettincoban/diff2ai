import fs from 'node:fs';
import path from 'node:path';
import { Minimatch } from 'minimatch';

export type IgnoreFilter = (relativePath: string) => boolean;

export function loadIgnore(cwd: string = process.cwd()): IgnoreFilter {
  const ignorePath = path.join(cwd, '.aidiffignore');
  let matchers: Minimatch[] = [];

  if (fs.existsSync(ignorePath)) {
    const patterns = fs
      .readFileSync(ignorePath, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    matchers = patterns.map((p) => new Minimatch(p, { dot: true }));
  }

  return (relativePath: string) => {
    if (!matchers.length) return false;
    return matchers.some((m) => m.match(relativePath));
  };
}

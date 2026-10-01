import fs from 'node:fs';
import path from 'node:path';
import { Minimatch } from 'minimatch';

export type IgnoreFilter = (rel: string) => boolean;

// Combines patterns from .aidiffignore with extra patterns (e.g. `exclude` from .aidiff.json).
export function loadIgnore(
  cwd: string = process.cwd(),
  extraPatterns: string[] = [],
): IgnoreFilter {
  const ignorePath = path.join(cwd, '.aidiffignore');
  const patterns: string[] = [...extraPatterns];

  if (fs.existsSync(ignorePath)) {
    const filePatterns = fs
      .readFileSync(ignorePath, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    patterns.push(...filePatterns);
  }
  const matchers: Minimatch[] = patterns.map((p) => new Minimatch(p, { dot: true }));

  return (relativePath: string) => {
    if (!matchers.length) return false;
    return matchers.some((m) => m.match(relativePath));
  };
}

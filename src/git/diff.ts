import path from 'node:path';
import simpleGit, { SimpleGit } from 'simple-git';
import type { IgnoreFilter } from '../config/ignore.js';

export type DiffOptions = {
  targetRef?: string; // e.g., origin/main
  staged?: boolean;
  commitSha?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  ignore?: IgnoreFilter;
};

function shouldInclude(filePath: string, includeGlobs?: string[], excludeGlobs?: string[]): boolean {
  // For MVP we rely on `git diff` to provide paths; basic include/exclude can be applied later if needed.
  // Here we simply honor exclude via ignore filter if provided externally.
  return true;
}

export async function generateUnifiedDiff(options: DiffOptions = {}, cwd: string = process.cwd()): Promise<string> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });

  if (options.commitSha) {
    const diff = await git.raw(['show', '-p', options.commitSha]);
    return diff;
  }

  if (options.staged) {
    const diff = await git.diff(['--staged']);
    return diff;
  }

  const targetRef = options.targetRef ?? 'origin/main';
  const range = `${targetRef}...HEAD`;
  const diff = await git.diff([range]);
  return diff;
}

import simpleGit, { SimpleGit } from 'simple-git';
import type { IgnoreFilter } from '../config/ignore.js';

export type DiffOptions = {
  targetRef?: string; // e.g., origin/main
  compareRef?: string; // e.g., pr-123 (local ref) or any commit-ish
  staged?: boolean;
  commitSha?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  ignore?: IgnoreFilter;
};

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

  if (options.compareRef) {
    const range = `${targetRef}...${options.compareRef}`;
    const diff = await git.diff([range]);
    return diff;
  }

  const range = `${targetRef}...HEAD`;
  const diff = await git.diff([range]);
  return diff;
}

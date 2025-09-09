import { simpleGit, type SimpleGit } from 'simple-git';
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

export async function generateUnifiedDiff(
  options: DiffOptions = {},
  cwd: string = process.cwd(),
): Promise<string> {
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
    return applyIgnoreFilter(diff, options.ignore);
  }

  const range = `${targetRef}...HEAD`;
  const diff = await git.diff([range]);
  return applyIgnoreFilter(diff, options.ignore);
}

function applyIgnoreFilter(unifiedDiff: string, ignore?: IgnoreFilter): string {
  if (!ignore) return unifiedDiff;
  if (!unifiedDiff || unifiedDiff.trim().length === 0) return unifiedDiff;

  const lines = unifiedDiff.split(/\r?\n/);
  const result: string[] = [];
  let buffer: string[] = [];
  let currentFile: string | null = null;

  const flush = () => {
    if (buffer.length === 0) return;
    if (currentFile && ignore(currentFile)) {
      // drop
    } else {
      result.push(...buffer);
    }
    buffer = [];
    currentFile = null;
  };

  for (const line of lines) {
    const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
    if (match) {
      // start of a new file section
      flush();
      currentFile = match[2] ?? match[1];
    }
    buffer.push(line);
  }
  flush();

  return result.join('\n');
}

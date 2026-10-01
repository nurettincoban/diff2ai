import type { IgnoreFilter } from '../config/ignore.js';
import { assertSafeRef, gitClient } from './repo.js';
import { sectionPath, splitFileSections } from './diffParse.js';

// Flags that pin the diff format regardless of the user's git config:
// color.diff/color.ui=always would inject ANSI codes, diff.noprefix or
// diff.mnemonicPrefix change the a/ b/ prefixes, and diff.external replaces
// the unified diff entirely. Each of these silently broke ignore filtering
// and polluted prompts.
export const SAFE_DIFF_FLAGS = [
  '--no-color',
  '--no-ext-diff',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];

export type DiffOptions = {
  targetRef?: string; // e.g., origin/main
  compareRef?: string; // e.g., a branch, refs/diff2ai/pr-12, or any commit-ish
  staged?: boolean;
  commitSha?: string;
  // Working tree (staged + unstaged tracked changes) vs merge-base(target, HEAD)
  worktree?: boolean;
  contextLines?: number; // -U<n>
  functionContext?: boolean; // -W: show the whole enclosing function
  ignore?: IgnoreFilter;
  onExclude?: (file: string) => void; // called for each file dropped by the ignore filter
};

function formatFlags(options: DiffOptions): string[] {
  const flags = [...SAFE_DIFF_FLAGS];
  if (options.contextLines !== undefined) flags.push(`--unified=${options.contextLines}`);
  if (options.functionContext) flags.push('--function-context');
  return flags;
}

export async function generateUnifiedDiff(
  options: DiffOptions = {},
  cwd: string = process.cwd(),
): Promise<string> {
  const git = gitClient(cwd);
  const flags = formatFlags(options);
  const filter = (diff: string) => applyIgnoreFilter(diff, options.ignore, options.onExclude);

  if (options.commitSha) {
    const sha = assertSafeRef(options.commitSha, 'commit');
    return filter(await git.raw(['show', ...flags, '--no-show-signature', sha]));
  }

  if (options.staged) {
    return filter(await git.raw(['diff', ...flags, '--cached']));
  }

  const targetRef = assertSafeRef(options.targetRef ?? 'origin/main', 'target');

  if (options.worktree) {
    const base = (await git.raw(['merge-base', targetRef, 'HEAD']).catch(() => '')).trim();
    if (!base) {
      throw new Error(`No common ancestor between ${targetRef} and HEAD; cannot diff against it.`);
    }
    return filter(await git.raw(['diff', ...flags, base]));
  }

  const compareRef = assertSafeRef(options.compareRef ?? 'HEAD');
  return filter(await git.raw(['diff', ...flags, `${targetRef}...${compareRef}`]));
}

// Drops whole file sections whose path matches the ignore filter. Sections
// are kept byte-for-byte (including CRLF line endings), so a filtered diff
// still applies cleanly with `git apply`.
export function applyIgnoreFilter(
  unifiedDiff: string,
  ignore?: IgnoreFilter,
  onExclude?: (file: string) => void,
): string {
  if (!ignore) return unifiedDiff;
  if (!unifiedDiff || unifiedDiff.trim().length === 0) return unifiedDiff;
  return splitFileSections(unifiedDiff)
    .filter((section) => {
      const file = sectionPath(section);
      if (file && ignore(file)) {
        onExclude?.(file);
        return false;
      }
      return true;
    })
    .join('');
}

import fs from 'node:fs';
import path from 'node:path';
import { gitClient } from '../git/repo.js';

export type PreflightSummary = {
  isDirty: boolean;
  hasUntracked: boolean;
  ongoingMerge: boolean;
  currentBranch: string | null;
  ahead: number;
  behind: number;
  lastFetchAgoSec: number | null;
  hasStash: boolean;
};

// Resolves a path inside the git dir (handles worktrees and $GIT_DIR).
async function gitPath(root: string, name: string): Promise<string | null> {
  try {
    const rel = (await gitClient(root).revparse(['--git-path', name])).trim();
    return rel ? path.resolve(root, rel) : null;
  } catch {
    return null;
  }
}

export async function gatherPreflight(root: string = process.cwd()): Promise<PreflightSummary> {
  const git = gitClient(root);
  const status = await git.status();
  const isDirty = status.files.length > 0;
  const hasUntracked = status.not_added.length > 0;
  const currentBranch = status.current ?? null;

  // StatusResult has no merge/rebase info; check the git dir markers directly.
  let ongoingMerge = false;
  for (const marker of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
  ]) {
    const p = await gitPath(root, marker);
    if (p && fs.existsSync(p)) {
      ongoingMerge = true;
      break;
    }
  }

  let ahead = 0;
  let behind = 0;
  try {
    const b = await git.revparse([`--abbrev-ref`, `${currentBranch}@{upstream}`]);
    const cnt = await git.raw([
      'rev-list',
      '--left-right',
      '--count',
      `${currentBranch}...${b.trim()}`,
    ]);
    const [left, right] = cnt
      .trim()
      .split(/\s+/)
      .map((s) => parseInt(s, 10));
    ahead = left || 0;
    behind = right || 0;
  } catch {
    // not tracking upstream
  }

  // Every fetch rewrites FETCH_HEAD; HEAD's reflog never records fetches.
  let lastFetchAgoSec: number | null = null;
  const fetchHead = await gitPath(root, 'FETCH_HEAD');
  if (fetchHead && fs.existsSync(fetchHead)) {
    lastFetchAgoSec = Math.max(0, Math.floor((Date.now() - fs.statSync(fetchHead).mtimeMs) / 1000));
  }

  let hasStash = false;
  try {
    const stash = await git.stashList();
    hasStash = (stash.all?.length ?? 0) > 0;
  } catch {
    // ignore
  }

  return {
    isDirty,
    hasUntracked,
    ongoingMerge,
    currentBranch,
    ahead,
    behind,
    lastFetchAgoSec,
    hasStash,
  };
}

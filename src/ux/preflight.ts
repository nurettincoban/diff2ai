import fs from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';

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

export async function gatherPreflight(): Promise<PreflightSummary> {
  const git = simpleGit();
  const status = await git.status();
  const isDirty = status.files.length > 0;
  const hasUntracked = status.not_added.length > 0;
  const currentBranch = status.current ?? null;

  // StatusResult has no merge/rebase info; check the git dir markers directly.
  let ongoingMerge = false;
  try {
    const gitDir = (await git.revparse(['--git-dir'])).trim();
    ongoingMerge = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'rebase-merge', 'rebase-apply'].some((f) =>
      fs.existsSync(path.join(gitDir, f)),
    );
  } catch {
    // ignore
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

  let lastFetchAgoSec: number | null = null;
  try {
    const reflog = await git.raw(['reflog', 'show', '--date=unix', '--grep-reflog', 'fetch']);
    const match = reflog.match(/@\s(\d+)/);
    if (match) {
      const ts = parseInt(match[1], 10) * 1000;
      lastFetchAgoSec = Math.floor((Date.now() - ts) / 1000);
    }
  } catch {
    // ignore
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

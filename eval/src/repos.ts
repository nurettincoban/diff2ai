import fs from 'node:fs';
import path from 'node:path';
import { gitClient } from '../../src/git/repo.js';
import { paths } from './config.js';
import type { ManifestPr } from './types.js';

export type PreparedPr = {
  repoDir: string;
  ref: string; // local branch at the PR head
  target: string; // local branch at the PR base, named like the real base branch
  stat: { files: number; additions: number; deletions: number };
  mismatch?: string; // set when the local diff does not match GitHub's numbers
};

async function hasCommit(repoDir: string, sha: string): Promise<boolean> {
  const out = await gitClient(repoDir)
    .raw(['cat-file', '-t', sha])
    .catch(() => '');
  return out.trim() === 'commit';
}

function parseShortstat(text: string): PreparedPr['stat'] {
  const num = (re: RegExp) => Number.parseInt(re.exec(text)?.[1] ?? '0', 10);
  return {
    files: num(/(\d+) files? changed/),
    additions: num(/(\d+) insertions?\(\+\)/),
    deletions: num(/(\d+) deletions?\(-\)/),
  };
}

// One cached repository per source repo, holding only the commit graph plus
// the trees and blobs the diffs need (treeless partial fetch). Nothing is
// checked out: the work tree contains just the eval .aidiff.json.
//
// Branches are re-pointed per PR, so PRs of the same repo must run one at a time.
export async function preparePr(pr: ManifestPr, aidiffConfig: string): Promise<PreparedPr> {
  const repoDir = path.join(paths.cache, 'repos', `${pr.owner}__${pr.repo}`);
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    fs.mkdirSync(repoDir, { recursive: true });
    const init = gitClient(repoDir);
    await init.raw(['init', '-q', '-b', 'eval-empty']);
    await init.raw(['remote', 'add', 'origin', `https://github.com/${pr.owner}/${pr.repo}.git`]);
    await init.raw(['config', 'remote.origin.promisor', 'true']);
    await init.raw(['config', 'remote.origin.partialclonefilter', 'tree:0']);
  }
  const git = gitClient(repoDir);
  if (!(await hasCommit(repoDir, pr.baseSha)) || !(await hasCommit(repoDir, pr.headSha))) {
    await git.raw([
      'fetch',
      '-q',
      '--no-tags',
      '--filter=tree:0',
      'origin',
      pr.baseSha,
      pr.headSha,
    ]);
  }
  const ref = `pr-${pr.number}`;
  const target = pr.baseRef;
  await git.raw(['branch', '-f', target, pr.baseSha]);
  await git.raw(['branch', '-f', ref, pr.headSha]);
  fs.writeFileSync(path.join(repoDir, '.aidiff.json'), aidiffConfig, 'utf-8');

  const stat = parseShortstat(await git.raw(['diff', '--shortstat', `${target}...${ref}`]));
  const expected = `${pr.changedFiles} files +${pr.additions}/-${pr.deletions}`;
  const actual = `${stat.files} files +${stat.additions}/-${stat.deletions}`;
  return {
    repoDir,
    ref,
    target,
    stat,
    mismatch:
      expected === actual ? undefined : `local diff is ${actual}, GitHub reports ${expected}`,
  };
}

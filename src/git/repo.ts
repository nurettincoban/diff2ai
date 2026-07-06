import fs from 'node:fs';
import path from 'node:path';
import simpleGit, { SimpleGit } from 'simple-git';

export function assertGitRepo(cwd: string = process.cwd()): void {
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    const message =
      'Error: Not a git repository. Ensure you are in a project with a .git directory.';
    throw new Error(message);
  }
}

export async function listRemoteBranches(cwd: string = process.cwd()): Promise<string[]> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });
  const result = await git.branch(['-r']);
  return result.all;
}

// Prefer origin/<branch>, fall back to the local ref for repos without a remote.
export async function resolveTargetRef(
  branch: string,
  cwd: string = process.cwd(),
): Promise<string> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });
  const candidates = [`origin/${branch}`, branch];
  for (const candidate of candidates) {
    // With --quiet git exits 1 without stderr, which simple-git reports as an
    // empty result rather than an error — so check the output, not just throws.
    const sha = await git
      .raw(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`])
      .catch(() => '');
    if (sha.trim()) return candidate;
  }
  throw new Error(
    `Target "${branch}" not found (tried: ${candidates.join(', ')}). Fetch it first or pass an existing branch via --target.`,
  );
}

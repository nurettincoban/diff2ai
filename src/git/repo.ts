import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';

// Every git invocation goes through this client. core.quotePath=false keeps
// non-ASCII paths readable instead of octal-escaped.
export function gitClient(baseDir: string): SimpleGit {
  return simpleGit({ baseDir, config: ['core.quotePath=false'] });
}

// Absolute path of the enclosing repository's top level. Works from any
// subdirectory (and in worktrees, where .git is a file).
export async function resolveRepoRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    const top = (await gitClient(cwd).revparse(['--show-toplevel'])).trim();
    if (top) return path.resolve(top);
  } catch {
    // fall through
  }
  throw new Error(
    'Not a git repository (or any parent directory). Run diff2ai inside a git working tree.',
  );
}

// Repo root when inside one, otherwise the directory itself. For commands
// that work on files (prompt, chunk, clean) but still want project config.
export async function findProjectRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    return await resolveRepoRoot(cwd);
  } catch {
    return cwd;
  }
}

// Refs come from the command line (and, in CI, from PR metadata). A value
// starting with "-" would be parsed by git as an option (e.g. --output=...),
// so reject it before it reaches any git command.
export function assertSafeRef(ref: string, what = 'ref'): string {
  const trimmed = ref.trim();
  if (!trimmed) throw new Error(`Empty ${what}.`);
  if (trimmed.startsWith('-')) {
    throw new Error(`Invalid ${what} "${ref}": git refs cannot start with "-".`);
  }
  if (/[\s\0]/.test(trimmed)) {
    throw new Error(`Invalid ${what} "${ref}": refs cannot contain whitespace.`);
  }
  return trimmed;
}

export async function listRemoteBranches(root: string = process.cwd()): Promise<string[]> {
  const result = await gitClient(root).branch(['-r']);
  // Drop symbolic entries like "origin/HEAD -> origin/main"
  return result.all.filter((b) => !/\/HEAD$/.test(b));
}

export async function currentBranch(root: string = process.cwd()): Promise<string | null> {
  try {
    const name = (await gitClient(root).revparse(['--abbrev-ref', 'HEAD'])).trim();
    return name && name !== 'HEAD' ? name : null;
  } catch {
    return null;
  }
}

export async function refExists(ref: string, root: string = process.cwd()): Promise<boolean> {
  // With --quiet git exits 1 without stderr, which simple-git reports as an
  // empty result rather than an error — so check the output, not just throws.
  const sha = await gitClient(root)
    .raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    .catch(() => '');
  return sha.trim().length > 0;
}

// Prefer origin/<branch>, fall back to the local ref for repos without a remote.
export async function resolveTargetRef(
  branch: string,
  root: string = process.cwd(),
): Promise<string> {
  assertSafeRef(branch, 'target branch');
  const candidates = [`origin/${branch}`, branch];
  for (const candidate of candidates) {
    if (await refExists(candidate, root)) return candidate;
  }
  throw new Error(
    `Target "${branch}" not found (tried: ${candidates.join(', ')}). Fetch it first or pass an existing branch via --target.`,
  );
}

// Fetches a GitHub PR or GitLab MR head into a private ref namespace, so no
// local branch is created or overwritten. Returns the local ref.
export async function fetchReviewRef(
  kind: 'pr' | 'mr',
  number: number,
  root: string,
  remote = 'origin',
): Promise<string> {
  const source = kind === 'pr' ? `refs/pull/${number}/head` : `refs/merge-requests/${number}/head`;
  const local = `refs/diff2ai/${kind}-${number}`;
  try {
    await gitClient(root).raw(['fetch', '--quiet', remote, `+${source}:${local}`]);
  } catch (error) {
    const label = kind === 'pr' ? `pull request #${number}` : `merge request !${number}`;
    throw new Error(
      `Could not fetch ${label} from "${remote}" (${source}): ${(error as Error).message.trim()}`,
    );
  }
  return local;
}

export type CommitLogOptions = { maxCommits?: number; maxBodyLines?: number; maxChars?: number };

// Commit subjects and bodies in `range` (oldest first), as a markdown list for
// the {commits} template placeholder. Commit messages carry the author's
// intent, which the diff alone does not.
export async function commitLog(
  range: string,
  root: string,
  opts: CommitLogOptions = {},
): Promise<string> {
  const maxCommits = opts.maxCommits ?? 50;
  const maxBodyLines = opts.maxBodyLines ?? 8;
  const maxChars = opts.maxChars ?? 6000;
  const git = gitClient(root);
  const total = Number.parseInt(
    (await git.raw(['rev-list', '--count', range]).catch(() => '0')).trim(),
    10,
  );
  if (!total) return '(no commits)';
  const raw = await git.raw([
    'log',
    '--no-color',
    '--no-show-signature',
    `--max-count=${maxCommits}`,
    '--format=%h%x1f%s%x1f%b%x1e',
    range,
  ]);
  const entries = raw
    .split('\x1e')
    .map((e) => e.trim())
    .filter(Boolean)
    .reverse();
  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    const [sha, subject, body = ''] = entry.split('\x1f');
    const bodyLines = body
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() && !/^(Co-Authored-By|Signed-off-by):/i.test(l.trim()));
    const block = [
      `- ${sha} ${subject}`,
      ...bodyLines.slice(0, maxBodyLines).map((l) => `  ${l}`),
      ...(bodyLines.length > maxBodyLines ? ['  …'] : []),
    ].join('\n');
    if (used + block.length > maxChars && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
  }
  if (total > blocks.length) blocks.push(`- … ${total - blocks.length} more commit(s) not shown`);
  return blocks.join('\n');
}

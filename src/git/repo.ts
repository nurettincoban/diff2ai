import fs from 'node:fs';
import path from 'node:path';
import simpleGit, { SimpleGit } from 'simple-git';

export function assertGitRepo(cwd: string = process.cwd()): void {
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) {
    const message = 'Error: Not a git repository. Ensure you are in a project with a .git directory.';
    throw new Error(message);
  }
}

export async function listRemoteBranches(cwd: string = process.cwd()): Promise<string[]> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });
  const result = await git.branch(['-r']);
  return result.all;
}

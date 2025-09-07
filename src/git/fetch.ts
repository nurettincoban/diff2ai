import simpleGit, { SimpleGit } from 'simple-git';

export type FetchResult = {
  localRef: string;
};

export async function fetchGithubPr(id: number, cwd: string = process.cwd()): Promise<FetchResult> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });
  const localRef = `pr-${id}`;
  try {
    await git.fetch('origin', `pull/${id}/head:${localRef}`);
    return { localRef };
  } catch (error) {
    const message = `Error: Could not fetch PR #${id}\nTry manually: git fetch origin pull/${id}/head:${localRef} && git checkout ${localRef}`;
    throw new Error(message);
  }
}

export async function fetchGitlabMr(id: number, cwd: string = process.cwd()): Promise<FetchResult> {
  const git: SimpleGit = simpleGit({ baseDir: cwd });
  const localRef = `mr-${id}`;
  try {
    await git.fetch('origin', `merge-requests/${id}/head:${localRef}`);
    return { localRef };
  } catch (error) {
    const message = `Error: Could not fetch MR #${id}\nTry manually: git fetch origin merge-requests/${id}/head:${localRef} && git checkout ${localRef}`;
    throw new Error(message);
  }
}

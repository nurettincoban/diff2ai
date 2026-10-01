import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Shared helpers for integration tests. Git identity and the default branch
// come from tests/fixtures/gitconfig (see vitest.config.ts).

export const projectRoot = path.resolve(process.cwd());
export const cli = path.join(projectRoot, 'dist', 'cli.js');
export const fixture = (name: string) => path.join(projectRoot, 'tests', 'fixtures', name);

export function run(cmd: string, cwd: string, env: Record<string, string> = {}): string {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, ...env } });
}

// Runs a command that must fail; returns its combined stdout + stderr.
export function runFail(cmd: string, cwd: string, env: Record<string, string> = {}): string {
  try {
    execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, ...env } });
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return String(err.stdout ?? '') + String(err.stderr ?? '');
  }
  throw new Error(`Expected command to fail: ${cmd}`);
}

export function diff2ai(args: string, cwd: string, env: Record<string, string> = {}): string {
  return run(`node "${cli}" ${args} 2>&1`, cwd, env);
}

export function ensureBuilt(): void {
  if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(dir: string, rel: string, content: string): void {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Repo on main with one commit, plus a bare "origin" that has main.
export function repoWithOrigin(prefix: string): { repo: string; remote: string } {
  const repo = tmpDir(prefix);
  run('git init', repo);
  write(repo, 'README.md', '# temp\n');
  run('git add README.md', repo);
  run('git commit -m "init"', repo);
  const remote = tmpDir(`${prefix}remote-`);
  run('git init --bare', remote);
  run(`git remote add origin "${remote}"`, repo);
  run('git push -q -u origin main', repo);
  return { repo, remote };
}

export function listReviews(repo: string): string[] {
  const dir = path.join(repo, 'reviews');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

export function readReview(repo: string, predicate: (f: string) => boolean): string {
  const name = listReviews(repo).find(predicate);
  if (!name)
    throw new Error(`No matching file in ${repo}/reviews: ${listReviews(repo).join(', ')}`);
  return fs.readFileSync(path.join(repo, 'reviews', name), 'utf-8');
}

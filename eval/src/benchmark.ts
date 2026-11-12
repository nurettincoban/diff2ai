import fs from 'node:fs';
import path from 'node:path';
import { gitClient } from '../../src/git/repo.js';
import { paths } from './config.js';
import type { EvalConfig, GoldenEntry } from './types.js';

// Only what the offline pipeline needs; the published results (tens of MB)
// stay on the server.
const SPARSE = [
  '/LICENSE',
  '/offline/pyproject.toml',
  '/offline/uv.lock',
  '/offline/code_review_benchmark/',
  '/offline/golden_comments/',
  '/offline/analysis/*.py',
];

// Clones the benchmark at the pinned commit into the cache (never vendored)
// and returns the path of its offline/ directory.
export async function ensureBenchmark(config: EvalConfig): Promise<string> {
  const dir = path.join(paths.cache, 'benchmark');
  const offline = path.join(dir, 'offline');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(dir, { recursive: true });
    const git = gitClient(dir);
    await git.raw(['init', '-q']);
    await git.raw(['remote', 'add', 'origin', config.benchmark.repo]);
    await git.raw(['config', 'remote.origin.promisor', 'true']);
    await git.raw(['config', 'remote.origin.partialclonefilter', 'blob:none']);
    await git.raw(['sparse-checkout', 'set', '--no-cone', ...SPARSE]);
    await git.raw([
      'fetch',
      '-q',
      '--no-tags',
      '--filter=blob:none',
      'origin',
      config.benchmark.commit,
    ]);
    await git.raw(['checkout', '-q', '--detach', config.benchmark.commit]);
  }
  const head = (await gitClient(dir).revparse(['HEAD'])).trim();
  if (head !== config.benchmark.commit) {
    throw new Error(
      `Benchmark checkout at ${dir} is at ${head}, expected the pinned ${config.benchmark.commit}. Delete eval/.cache/benchmark and retry.`,
    );
  }
  const dirty = (
    await gitClient(dir).raw(['status', '--porcelain', '--untracked-files=no'])
  ).trim();
  if (dirty) {
    throw new Error(`Benchmark checkout at ${dir} has local changes; it must stay unmodified.`);
  }
  return offline;
}

// Golden comments keyed by PR URL, exactly as in the pinned checkout.
export function loadGolden(offlineDir: string): Map<string, GoldenEntry> {
  const dir = path.join(offlineDir, 'golden_comments');
  const out = new Map<string, GoldenEntry>();
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const entries = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as Omit<
      GoldenEntry,
      'source_file'
    >[];
    for (const entry of entries) out.set(entry.url, { ...entry, source_file: file });
  }
  return out;
}

// One-off generator for eval/manifest.json and eval/split.json. Reads the
// golden PR list from the pinned benchmark checkout and asks GitHub (via gh)
// for each PR's base and head commit. The output is committed and then frozen:
// re-running it is only needed when the benchmark pin changes.
import fs from 'node:fs';
import { ensureBenchmark, loadGolden } from './benchmark.js';
import { loadConfig, paths, prId } from './config.js';
import { runProc } from './proc.js';
import { makeSplit } from './split.js';
import type { ManifestPr } from './types.js';

type GhPull = {
  title: string;
  additions: number;
  deletions: number;
  changed_files: number;
  base: { ref: string; sha: string };
  head: { sha: string };
};

async function main(): Promise<void> {
  const config = loadConfig(process.argv[2] ?? 'eval/config/baseline.json');
  const golden = loadGolden(await ensureBenchmark(config));
  const manifest: ManifestPr[] = [];
  for (const entry of golden.values()) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(entry.url);
    if (!m) throw new Error(`Unrecognised golden URL: ${entry.url}`);
    const [, owner, repo, num] = m;
    const res = await runProc('gh', ['api', `repos/${owner}/${repo}/pulls/${num}`]);
    if (res.code !== 0) throw new Error(`gh api failed for ${entry.url}: ${res.stderr.trim()}`);
    const pull = JSON.parse(res.stdout) as GhPull;
    manifest.push({
      id: prId(repo, Number(num)),
      source: entry.source_file.replace(/\.json$/, ''),
      goldenUrl: entry.url,
      owner,
      repo,
      number: Number(num),
      title: pull.title,
      baseRef: pull.base.ref,
      baseSha: pull.base.sha,
      headSha: pull.head.sha,
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
      goldenCount: entry.comments.length,
    });
    console.log(`${manifest.length}/${golden.size} ${manifest[manifest.length - 1].id}`);
  }
  const ids = new Set(manifest.map((p) => p.id));
  if (ids.size !== manifest.length) throw new Error('PR ids are not unique.');
  fs.writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  const split = makeSplit(manifest, config.split.seed, config.split.devPerSource);
  fs.writeFileSync(paths.split, JSON.stringify(split, null, 2) + '\n', 'utf-8');
  console.log(
    `Wrote ${manifest.length} PRs to eval/manifest.json; split: ${split.dev.length} dev, ${split.heldout.length} held out (seed ${split.seed}).`,
  );
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

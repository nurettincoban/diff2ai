// npm run eval:report -- --run <run> [--out <file>]
//
// Breaks a committed run down by source repository. Reads only files under
// eval/results/; calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { loadManifest } from './config.js';
import { loadRun, subsetSummary } from './runs.js';

function main(): void {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const runId = value('--run');
  if (!runId) throw new Error('Usage: --run <run> [--out <file>]');
  const run = loadRun(runId);
  const manifest = loadManifest().filter((p) => run.records.has(p.id));
  const urlOf = new Map(manifest.map((p) => [p.id, p.goldenUrl]));

  const bySource = [...new Set(manifest.map((p) => p.source))].sort().map((source) => {
    const prs = manifest.filter((p) => p.source === source);
    const s = subsetSummary(
      run,
      prs.map((p) => p.id),
      urlOf,
    );
    return {
      source,
      prs: prs.length,
      goldenComments: prs.reduce((n, p) => n + p.goldenCount, 0),
      core: s.profiles.core,
      findingsPerPr: s.findings.perPr,
      candidatesPerPr: s.findings.candidatesPerPr,
      costPerPrUsd: s.cost.perPrUsd,
      reviewErrors: s.reviewErrors.length,
    };
  });
  const overall = subsetSummary(
    run,
    manifest.map((p) => p.id),
    urlOf,
  );
  const result = {
    label: 'self-run, not independently scored',
    run: runId,
    config: run.config.name,
    prs: manifest.length,
    candidatesPerFinding: overall.findings.total
      ? overall.findings.candidatesTotal / overall.findings.total
      : 0,
    bySource,
  };

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(
    [
      `${runId} (${run.config.name}) by source repository, Core profile — ${result.label}`,
      '',
      '| Source | PRs | Golden | Precision | Recall | F1 | TP | FP | FN | Findings/PR | Cost/PR |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...bySource.map(
        (r) =>
          `| ${r.source} | ${r.prs} | ${r.goldenComments} | ${pct(r.core.precision)} | ${pct(r.core.recall)} | ${pct(r.core.f1)} | ${r.core.tp} | ${r.core.fp} | ${r.core.fn} | ${r.findingsPerPr.toFixed(2)} | $${r.costPerPrUsd.toFixed(3)} |`,
      ),
      '',
      `Judge candidates per finding: ${result.candidatesPerFinding.toFixed(2)}`,
    ].join('\n'),
  );
  const out = value('--out');
  if (out) {
    fs.writeFileSync(path.resolve(process.cwd(), out), JSON.stringify(result, null, 2) + '\n');
    console.log(`Wrote ${out}`);
  }
}

try {
  main();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}

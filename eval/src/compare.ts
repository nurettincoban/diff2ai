// npm run eval:compare -- --base <run> --variant <run> [--split dev|heldout] [--out <file>]
//
// Scores two committed runs on the same PRs and reports the difference with a
// paired bootstrap interval. Reads only files under eval/results/; calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { loadManifest, loadSplit } from './config.js';
import type { ProfileName, Summary } from './metrics.js';
import { loadRun, subsetSummary } from './runs.js';
import { pairedBootstrap, prCounts } from './stats.js';

function main(): void {
  const argv = process.argv.slice(2);
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const baseId = value('--base');
  const variantId = value('--variant');
  if (!baseId || !variantId)
    throw new Error('Usage: --base <run> --variant <run> [--split dev|heldout]');
  const splitName = value('--split');
  const manifest = loadManifest();
  const urlOf = new Map(manifest.map((p) => [p.id, p.goldenUrl]));
  const base = loadRun(baseId);
  const variant = loadRun(variantId);
  const ids =
    splitName === 'dev' || splitName === 'heldout'
      ? loadSplit()[splitName]
      : [...variant.records.keys()].filter((id) => base.records.has(id)).sort();
  const seed = base.config.split.seed;
  const resamples = 10_000;

  const sides = {
    baseline: subsetSummary(base, ids, urlOf),
    variant: subsetSummary(variant, ids, urlOf),
  };
  const bootstrap = Object.fromEntries(
    (['strict', 'core', 'all'] as ProfileName[]).map((profile) => [
      profile,
      pairedBootstrap(
        ids.map((id) => prCounts(base.evals, base.config.tool, profile, urlOf.get(id) as string)),
        ids.map((id) =>
          prCounts(variant.evals, variant.config.tool, profile, urlOf.get(id) as string),
        ),
        { resamples, seed },
      ),
    ]),
  );
  const result = {
    label: 'self-run, not independently scored',
    baselineRun: baseId,
    variantRun: variantId,
    variantConfig: variant.config.name,
    split: splitName ?? 'common PRs',
    prs: ids,
    baseline: sides.baseline,
    variant: sides.variant,
    pairedBootstrap: bootstrap,
  };

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const pts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;
  const row = (name: string, s: Summary) => {
    const m = s.profiles.core;
    return `| ${name} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.tp} | ${m.fp} | ${m.fn} | ${s.findings.perPr.toFixed(2)} | $${s.cost.perPrUsd.toFixed(3)} | ${s.reviewErrors.length} |`;
  };
  const core = bootstrap.core;
  console.log(
    [
      `${variantId} (${variant.config.name}) vs ${baseId} on ${ids.length} PR(s) [${result.split}] — ${result.label}`,
      '',
      '| Run | Precision | Recall | F1 | TP | FP | FN | Findings/PR | Cost/PR | Errors |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      row(baseId, sides.baseline),
      row(variantId, sides.variant),
      '',
      `Core F1 difference: ${pts(core.f1.delta)} points, 95% paired bootstrap interval ${pts(core.f1.low)} to ${pts(core.f1.high)} (${resamples} resamples, seed ${seed})`,
      `Precision ${pts(core.precision.delta)} (${pts(core.precision.low)} to ${pts(core.precision.high)}), recall ${pts(core.recall.delta)} (${pts(core.recall.low)} to ${pts(core.recall.high)})`,
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

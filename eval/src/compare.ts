// npm run eval:compare -- --base <run> --variant <run> [--split dev|heldout] [--out <file>]
//
// Scores two committed runs on the same PRs and reports the difference with a
// paired bootstrap interval. Reads only files under eval/results/; calls nothing.
import fs from 'node:fs';
import path from 'node:path';
import { loadManifest, loadSplit, paths } from './config.js';
import { modelDirName } from './judge.js';
import { summarize, type ProfileName, type Summary } from './metrics.js';
import { pairedBootstrap, prCounts } from './stats.js';
import type { EvalConfig, Evaluations, PrRecord } from './types.js';

type Run = { id: string; config: EvalConfig; evals: Evaluations; records: Map<string, PrRecord> };

function loadRun(id: string): Run {
  const dir = path.join(paths.results, id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf-8')) as {
    config: EvalConfig;
  };
  const evals = JSON.parse(
    fs.readFileSync(
      path.join(dir, 'judge', 'results', modelDirName(meta.config.judge.model), 'evaluations.json'),
      'utf-8',
    ),
  ) as Evaluations;
  const records = new Map<string, PrRecord>();
  for (const file of fs.readdirSync(path.join(dir, 'prs'))) {
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'prs', file), 'utf-8')) as PrRecord;
    records.set(record.id, record);
  }
  return { id, config: meta.config, evals, records };
}

// A run restricted to the given PRs: judge verdicts, records and judge cost.
function subset(run: Run, ids: string[], urlOf: Map<string, string>): Summary {
  const evals: Evaluations = {};
  const records: PrRecord[] = [];
  for (const id of ids) {
    const record = run.records.get(id);
    if (!record) throw new Error(`Run ${run.id} has no record for ${id}.`);
    records.push(record);
    const url = urlOf.get(id) as string;
    if (run.evals[url]) evals[url] = run.evals[url];
  }
  const judgeUsd = records.reduce((n, r) => n + (r.judgeUsage?.costUsd ?? 0), 0);
  return summarize({ evals, tool: run.config.tool, records, judgeUsd });
}

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

  const sides = { baseline: subset(base, ids, urlOf), variant: subset(variant, ids, urlOf) };
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

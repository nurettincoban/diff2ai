import { PROFILES, prf, type ProfileName } from './metrics.js';
import { mulberry32 } from './split.js';
import type { Evaluations } from './types.js';

export type Counts = { tp: number; fp: number; fn: number };

// TP/FP/FN of one PR under a profile, with the same matched-excluded rule as
// scoreProfile(). A PR the judge has no verdict for contributes nothing.
export function prCounts(
  evals: Evaluations,
  tool: string,
  profile: ProfileName,
  url: string,
): Counts {
  const e = evals[url]?.[tool];
  if (!e || e.skipped) return { tp: 0, fp: 0, fn: 0 };
  const cats = new Set<string>(PROFILES[profile]);
  return {
    tp: (e.true_positives ?? []).filter((t) => cats.has(t.category ?? '')).length,
    fp: e.fp ?? 0,
    fn: (e.false_negatives ?? []).filter((f) => cats.has(f.category ?? '')).length,
  };
}

function micro(counts: Counts[]) {
  const sum = counts.reduce((a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn }), {
    tp: 0,
    fp: 0,
    fn: 0,
  });
  return prf(sum.tp, sum.fp, sum.fn);
}

export type Interval = { delta: number; low: number; high: number };

export type PairedBootstrap = {
  resamples: number;
  seed: number;
  f1: Interval;
  precision: Interval;
  recall: Interval;
};

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

// Paired bootstrap over PRs: the same resampled PRs are scored for both
// configurations, and the difference (variant minus baseline) of each micro
// metric is collected. The interval is the 2.5th to 97.5th percentile.
// It reflects which PRs were sampled, not model run-to-run variation.
export function pairedBootstrap(
  baseline: Counts[],
  variant: Counts[],
  opts: { resamples: number; seed: number },
): PairedBootstrap {
  if (baseline.length !== variant.length || baseline.length === 0) {
    throw new Error('Paired bootstrap needs the same, non-empty set of PRs on both sides.');
  }
  const n = baseline.length;
  const random = mulberry32(opts.seed);
  const deltas = { f1: [] as number[], precision: [] as number[], recall: [] as number[] };
  for (let r = 0; r < opts.resamples; r++) {
    const b: Counts[] = [];
    const v: Counts[] = [];
    for (let k = 0; k < n; k++) {
      const i = Math.floor(random() * n);
      b.push(baseline[i]);
      v.push(variant[i]);
    }
    const mb = micro(b);
    const mv = micro(v);
    deltas.f1.push(mv.f1 - mb.f1);
    deltas.precision.push(mv.precision - mb.precision);
    deltas.recall.push(mv.recall - mb.recall);
  }
  const point = { b: micro(baseline), v: micro(variant) };
  const interval = (key: 'f1' | 'precision' | 'recall'): Interval => {
    const sorted = deltas[key].sort((x, y) => x - y);
    return {
      delta: point.v[key] - point.b[key],
      low: percentile(sorted, 0.025),
      high: percentile(sorted, 0.975),
    };
  };
  return {
    resamples: opts.resamples,
    seed: opts.seed,
    f1: interval('f1'),
    precision: interval('precision'),
    recall: interval('recall'),
  };
}

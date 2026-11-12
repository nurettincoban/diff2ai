import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseFindings } from '../src/formatters/findings.js';
import { toReviewComments } from '../eval/src/adapter.js';
import { configHash } from '../eval/src/config.js';
import { estimateRun } from '../eval/src/cost.js';
import { scoreProfile } from '../eval/src/metrics.js';
import { pairedBootstrap, prCounts, type Counts } from '../eval/src/stats.js';
import type { EvalConfig, Evaluations } from '../eval/src/types.js';

// Experiment tooling: variant configs, the severity filter and the paired
// bootstrap used to compare two runs. Offline.

const load = (name: string) =>
  JSON.parse(fs.readFileSync(`eval/config/${name}.json`, 'utf-8')) as EvalConfig;

describe('variant configs', () => {
  const baseline = load('baseline');

  it('each differs from the baseline in one setting and has its own hash', () => {
    const consensus = load('consensus3');
    const sonnet = load('sonnet');
    const minMedium = load('min-medium');
    expect(consensus.reviewer.reviewArgs).toEqual(['--iterations', '3']);
    expect({ ...consensus.reviewer, reviewArgs: [] }).toEqual(baseline.reviewer);
    expect(sonnet.reviewer).toEqual({ ...baseline.reviewer, model: 'claude-sonnet-5-5' });
    expect(minMedium.post).toEqual({ minSeverity: 'MEDIUM' });
    expect(minMedium.reviewer).toEqual(baseline.reviewer);
    for (const c of [consensus, sonnet, minMedium]) {
      expect(c.judge).toEqual(baseline.judge);
      expect(c.benchmark).toEqual(baseline.benchmark);
      expect(c.budgetUsd).toBe(baseline.budgetUsd);
    }
    const hashes = [baseline, consensus, sonnet, minMedium].map(configHash);
    expect(new Set(hashes).size).toBe(4);
  });

  it('ignores budget, prices and estimate assumptions in the hash', () => {
    const tweaked = { ...baseline, budgetUsd: 1, estimate: { ...baseline.estimate, basis: 'x' } };
    expect(configHash(tweaked)).toBe(configHash(baseline));
  });

  it('scales the reviewer estimate by the calls per review', () => {
    const prompts = [{ chars: 10_000, goldenCount: 3 }];
    const single = estimateRun(baseline, prompts, 1);
    const multi = estimateRun(baseline, prompts, 4);
    expect(multi.reviewerUsd.low).toBeCloseTo(single.reviewerUsd.low * 4);
    expect(multi.judgeUsd).toEqual(single.judgeUsd);
  });
});

describe('minimum severity filter', () => {
  const block = (n: number, severity: string, extra = '') =>
    `## ${n}) Severity: ${severity} | Type: Bug\n${extra}Title: Finding ${n}\n\nAffected:\n- a.ts:${n}\n\nExplanation:\nText.\n`;
  const findings = parseFindings(
    [
      block(1, 'HIGH'),
      block(2, 'LOW'),
      block(3, 'MEDIUM'),
      block(4, 'CRITICAL', 'Verification: failed — not in the diff\n'),
      block(5, 'INFO'),
    ].join('\n'),
  );

  it('keeps everything verified when no threshold is set', () => {
    expect(toReviewComments(findings, 't')).toHaveLength(4);
  });

  it('keeps verified findings at or above the threshold, like `post --min-severity`', () => {
    const kept = toReviewComments(findings, 't', 'MEDIUM');
    expect(kept.map((c) => c.line)).toEqual([1, 3]);
    expect(() => toReviewComments(findings, 't', 'URGENT')).toThrow(/Unknown severity/);
  });
});

describe('prCounts', () => {
  const evals: Evaluations = {
    u1: {
      diff2ai: {
        fp: 2,
        true_positives: [
          { golden_comment: 'a', category: 'bug' },
          { golden_comment: 'b', category: 'style' },
        ],
        false_negatives: [{ golden_comment: 'c', category: 'perf' }],
      },
    },
    u2: { diff2ai: { skipped: true } },
  };

  it('applies the profile per PR and agrees with the aggregate score', () => {
    expect(prCounts(evals, 'diff2ai', 'core', 'u1')).toEqual({ tp: 1, fp: 2, fn: 1 });
    expect(prCounts(evals, 'diff2ai', 'strict', 'u1')).toEqual({ tp: 1, fp: 2, fn: 0 });
    expect(prCounts(evals, 'diff2ai', 'all', 'u1')).toEqual({ tp: 2, fp: 2, fn: 1 });
    const total = scoreProfile(evals, 'diff2ai', 'all');
    expect({ tp: total.tp, fp: total.fp, fn: total.fn }).toEqual({ tp: 2, fp: 2, fn: 1 });
  });

  it('gives zeros for a missing or skipped PR', () => {
    expect(prCounts(evals, 'diff2ai', 'core', 'u2')).toEqual({ tp: 0, fp: 0, fn: 0 });
    expect(prCounts(evals, 'diff2ai', 'core', 'nope')).toEqual({ tp: 0, fp: 0, fn: 0 });
  });
});

describe('pairedBootstrap', () => {
  const opts = { resamples: 2000, seed: 7 };
  const base: Counts[] = Array.from({ length: 20 }, (_, i) => ({ tp: 2, fp: 4 + (i % 3), fn: 1 }));

  it('is deterministic for a seed', () => {
    const better = base.map((c) => ({ ...c, fp: 1 }));
    expect(pairedBootstrap(base, better, opts)).toEqual(pairedBootstrap(base, better, opts));
  });

  it('reports a zero difference with a zero-width interval for identical runs', () => {
    const same = pairedBootstrap(base, base, opts);
    expect(same.f1).toEqual({ delta: 0, low: 0, high: 0 });
  });

  it('excludes zero when the variant is better on every PR', () => {
    const better = base.map((c) => ({ ...c, fp: 1 }));
    const out = pairedBootstrap(base, better, opts);
    expect(out.f1.delta).toBeGreaterThan(0);
    expect(out.f1.low).toBeGreaterThan(0);
    expect(out.precision.low).toBeGreaterThan(0);
    expect(out.recall).toEqual({ delta: 0, low: 0, high: 0 });
    expect(out.f1.low).toBeLessThanOrEqual(out.f1.delta);
    expect(out.f1.high).toBeGreaterThanOrEqual(out.f1.delta);
  });

  it('includes zero when gains and losses cancel out across PRs', () => {
    const mixed = base.map((c, i) => ({
      ...c,
      fp: i % 2 === 0 ? c.fp + 3 : Math.max(0, c.fp - 3),
    }));
    const out = pairedBootstrap(base, mixed, opts);
    expect(out.f1.low).toBeLessThan(0);
    expect(out.f1.high).toBeGreaterThan(0);
  });

  it('rejects unpaired input', () => {
    expect(() => pairedBootstrap(base, base.slice(1), opts)).toThrow(/same, non-empty/);
    expect(() => pairedBootstrap([], [], opts)).toThrow(/same, non-empty/);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { capUsd, costUsd, estimateRun, overCap, priceFor } from '../eval/src/cost.js';
import {
  prf,
  recallBySeverity,
  renderSummary,
  scoreProfile,
  summarize,
} from '../eval/src/metrics.js';
import { mockUpstream } from '../eval/src/mock.js';
import { startProxy, usageByPr } from '../eval/src/proxy.js';
import { makeSplit } from '../eval/src/split.js';
import type { EvalConfig, Evaluations, ManifestPr, PrRecord } from '../eval/src/types.js';

// Metric aggregation, cost maths, the seeded split and the judge proxy.
// Everything here runs offline; the proxy test talks to loopback only.

const tp = (category: string, severity: string) => ({ golden_comment: 'g', severity, category });

// Shape of the benchmark's evaluations.json: PR url -> tool -> verdict.
const EVALS: Evaluations = {
  'https://github.com/o/r/pull/1': {
    diff2ai: {
      fp: 2,
      total_candidates: 4,
      errors_count: 1,
      true_positives: [tp('bug', 'High'), tp('style', 'Low')],
      false_negatives: [tp('security', 'Critical'), tp('perf', 'Medium')],
    },
    othertool: { fp: 50, true_positives: [], false_negatives: [tp('bug', 'High')] },
  },
  'https://github.com/o/r/pull/2': {
    diff2ai: {
      fp: 1,
      total_candidates: 2,
      true_positives: [tp('bug', 'High')],
      false_negatives: [tp('speculative', 'Low')],
    },
  },
  'https://github.com/o/r/pull/3': { diff2ai: { skipped: true } },
};

describe('scoreProfile', () => {
  it('micro-averages over PRs and ignores other tools and skipped entries', () => {
    const all = scoreProfile(EVALS, 'diff2ai', 'all');
    expect(all).toMatchObject({ tp: 3, fp: 3, fn: 3, prs: 2 });
    expect(all.precision).toBeCloseTo(0.5);
    expect(all.recall).toBeCloseTo(0.5);
    expect(all.f1).toBeCloseTo(0.5);
  });

  it('treats matches outside the profile as matched-excluded', () => {
    // core drops style and speculative: the style match is no longer a TP,
    // the speculative miss is no longer an FN, false positives are unchanged
    expect(scoreProfile(EVALS, 'diff2ai', 'core')).toMatchObject({ tp: 2, fp: 3, fn: 2 });
    // strict also drops perf
    const strict = scoreProfile(EVALS, 'diff2ai', 'strict');
    expect(strict).toMatchObject({ tp: 2, fp: 3, fn: 1 });
    expect(strict.precision).toBeCloseTo(2 / 5);
    expect(strict.recall).toBeCloseTo(2 / 3);
  });

  it('returns zeros instead of dividing by zero', () => {
    expect(prf(0, 0, 0)).toEqual({ precision: 0, recall: 0, f1: 0 });
    expect(scoreProfile({}, 'diff2ai', 'core')).toMatchObject({ tp: 0, prs: 0, f1: 0 });
  });
});

describe('recallBySeverity', () => {
  it('groups golden comments of the profile by their severity', () => {
    expect(recallBySeverity(EVALS, 'diff2ai', 'core')).toEqual([
      { severity: 'Critical', found: 0, total: 1, recall: 0 },
      { severity: 'High', found: 2, total: 2, recall: 1 },
      { severity: 'Medium', found: 0, total: 1, recall: 0 },
    ]);
  });
});

const record = (id: string, patch: Partial<PrRecord> = {}): PrRecord => ({
  id,
  goldenUrl: `https://github.com/o/r/pull/${id}`,
  status: 'findings',
  findings: [],
  postedComments: 0,
  unverifiedFindings: 0,
  usage: [],
  costUsd: 0,
  durationMs: 0,
  ...patch,
});

describe('summarize', () => {
  const finding = (severity: string) => ({
    severity,
    type: 'Bug',
    title: 't',
    affected: [],
    verified: true,
  });
  const summary = summarize({
    evals: EVALS,
    tool: 'diff2ai',
    judgeUsd: 0.5,
    records: [
      record('1', { findings: [finding('HIGH'), finding('LOW')], costUsd: 0.25, durationMs: 4000 }),
      record('2', {
        findings: [finding('HIGH')],
        unverifiedFindings: 1,
        costUsd: 0.25,
        durationMs: 2000,
      }),
      record('3', { status: 'run_failed', error: 'timed out' }),
      record('4', { status: 'no_issues' }),
    ],
  });

  it('labels the result and reports failed runs instead of dropping them', () => {
    expect(summary.label).toBe('self-run, not independently scored');
    expect(summary.prsSelected).toBe(4);
    expect(summary.prsJudged).toBe(2);
    expect(summary.reviewErrors).toEqual([{ id: '3', status: 'run_failed', error: 'timed out' }]);
    expect(summary.judgeErrors).toBe(1);
  });

  it('counts findings, candidates and cost per PR', () => {
    expect(summary.findings).toMatchObject({
      total: 3,
      perPr: 0.75,
      unverified: 1,
      candidatesTotal: 6,
    });
    expect(summary.findings.bySeverity).toEqual({ HIGH: 2, LOW: 1 });
    expect(summary.cost).toEqual({ reviewerUsd: 0.5, judgeUsd: 0.5, totalUsd: 1, perPrUsd: 0.25 });
    expect(summary.durationMs).toEqual({ reviewTotal: 6000, reviewPerPr: 1500 });
  });

  it('renders the label, the table and the errors', () => {
    const text = renderSummary(summary);
    expect(text).toContain('self-run, not independently scored');
    expect(text).toContain('| core | 40.0% | 50.0% | 44.4% | 2 | 3 | 2 |');
    expect(text).toContain('Error: 3: run_failed (timed out)');
  });
});

const CONFIG = JSON.parse(fs.readFileSync('eval/config/baseline.json', 'utf-8')) as EvalConfig;

describe('cost', () => {
  it('prices tokens per million', () => {
    expect(
      costUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, { input: 4, output: 20 }),
    ).toBe(14);
    expect(() => priceFor(CONFIG, 'no-such-model')).toThrow(/No price for model/);
  });

  it('builds the estimate from prompt sizes and the configured assumptions', () => {
    const config: EvalConfig = {
      ...CONFIG,
      reviewer: { ...CONFIG.reviewer, model: 'r' },
      judge: { ...CONFIG.judge, model: 'j' },
      pricingUsdPerMTok: { r: { input: 4, output: 20 }, j: { input: 5, output: 25 } },
      estimate: {
        reviewerOutputTokens: { low: 1000, high: 2000 },
        candidatesPerPr: { low: 5, high: 10 },
        judgeCallTokens: { input: 300, output: 100 },
        extractDedupTokens: { input: 4000, output: 1000 },
      },
    };
    const e = estimateRun(config, [
      { chars: 12_000, goldenCount: 2 },
      { chars: 24_000, goldenCount: 4 },
    ]);
    expect(e.reviewerInputTokens).toEqual({ low: 9000, high: 12_000 });
    // low: (9000*4 + 2000*20)/1e6 ; high: (12000*4 + 4000*20)/1e6
    expect(e.reviewerUsd.low).toBeCloseTo(0.076);
    expect(e.reviewerUsd.high).toBeCloseTo(0.128);
    // low: 6 golden * 5 candidates = 30 calls -> in 9000+8000, out 3000+2000
    expect(e.judgeUsd.low).toBeCloseTo((17_000 * 5 + 5000 * 25) / 1e6);
    expect(e.totalUsd.high).toBeCloseTo(e.reviewerUsd.high + e.judgeUsd.high);
  });

  it('stops only above 125% of the approved amount', () => {
    expect(capUsd(4)).toBe(5);
    expect(overCap(5, 4)).toBe(false);
    expect(overCap(5.01, 4)).toBe(true);
  });
});

describe('split', () => {
  const manifest = JSON.parse(fs.readFileSync('eval/manifest.json', 'utf-8')) as ManifestPr[];
  const committed = JSON.parse(fs.readFileSync('eval/split.json', 'utf-8')) as ReturnType<
    typeof makeSplit
  >;

  it('covers the 50 benchmark PRs with unique ids', () => {
    expect(manifest).toHaveLength(50);
    expect(new Set(manifest.map((p) => p.id)).size).toBe(50);
    expect(manifest.reduce((n, p) => n + p.goldenCount, 0)).toBe(173);
  });

  it('is reproducible from the seed and matches the committed file', () => {
    const again = makeSplit(manifest, CONFIG.split.seed, CONFIG.split.devPerSource);
    expect(again).toEqual(committed);
    expect(makeSplit(manifest, CONFIG.split.seed + 1, 2)).not.toEqual(committed);
  });

  it('is disjoint, complete and stratified by source', () => {
    expect(committed.dev).toHaveLength(10);
    expect(committed.heldout).toHaveLength(40);
    expect(new Set([...committed.dev, ...committed.heldout]).size).toBe(50);
    const sourceOf = new Map(manifest.map((p) => [p.id, p.source]));
    for (const source of new Set(sourceOf.values())) {
      expect(committed.dev.filter((id) => sourceOf.get(id) === source)).toHaveLength(2);
    }
  });
});

describe('judge proxy', () => {
  const judgeRequest = (golden: string, candidate: string) =>
    JSON.stringify({
      model: 'm',
      messages: [
        {
          role: 'system',
          content: 'You are a precise code review evaluator. Always respond with valid JSON.',
        },
        {
          role: 'user',
          content: `Golden Comment (x):\n${golden}\n\nCandidate Issue (y):\n${candidate}\n\nInstructions:`,
        },
      ],
    });

  it('logs usage per PR, never the auth header, and trips the cost cap', async () => {
    const logFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd2a-eval-')), 'calls.jsonl');
    let capHit = 0;
    const proxy = await startProxy({
      upstream: mockUpstream,
      logFile,
      price: { input: 1_000_000, output: 0 }, // $1 per input token
      capUsd: 30,
      needles: [{ kind: 'judge', text: 'golden one', pr: 'pr-a' }],
      onCap: () => capHit++,
    });
    const post = (body: string) =>
      fetch(`${proxy.url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer test-secret' },
        body,
      });

    const first = await post(judgeRequest('golden one', 'Shared issue'));
    expect(first.status).toBe(200);
    const verdict = JSON.parse(
      ((await first.json()) as { choices: { message: { content: string } }[] }).choices[0].message
        .content,
    );
    expect(verdict).toHaveProperty('match');
    expect(proxy.calls[0]).toMatchObject({ kind: 'judge', pr: 'pr-a', status: 200, model: 'm' });
    expect(proxy.calls[0].inputTokens).toBeGreaterThan(0);

    await post(judgeRequest('unknown golden', 'x'));
    expect(proxy.calls[1].pr).toBeNull();
    expect(capHit).toBe(1);
    expect(proxy.capReached()).toBe(true);
    expect((await post(judgeRequest('golden one', 'x'))).status).toBe(400);

    const byPr = usageByPr(proxy.calls, { input: 1_000_000, output: 0 });
    expect(byPr.get('pr-a')?.calls).toBe(1);
    expect(byPr.get('(unattributed)')?.calls).toBe(1);
    expect(fs.readFileSync(logFile, 'utf-8')).not.toContain('test-secret');
    await proxy.close();
  });
});

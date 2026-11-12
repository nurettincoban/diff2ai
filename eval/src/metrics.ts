import type { Evaluations, JudgeEval, PrRecord } from './types.js';

// Category profiles, identical to offline/analysis/score_profiles.py at the
// pinned benchmark commit. A match on a golden comment outside the active
// profile is "matched-excluded": neither a true positive nor a miss.
export const PROFILES = {
  strict: ['bug', 'security', 'concurrency', 'data', 'api'],
  core: ['bug', 'security', 'concurrency', 'data', 'api', 'perf', 'test_gap', 'doc_defect'],
  all: [
    'bug',
    'security',
    'concurrency',
    'data',
    'api',
    'perf',
    'test_gap',
    'doc_defect',
    'style',
    'speculative',
  ],
} as const;

export type ProfileName = keyof typeof PROFILES;

export type Score = {
  tp: number;
  fp: number;
  fn: number;
  prs: number;
  precision: number;
  recall: number;
  f1: number;
};

function ratio(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

export function prf(tp: number, fp: number, fn: number): Omit<Score, 'tp' | 'fp' | 'fn' | 'prs'> {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return { precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}

function toolEvals(evals: Evaluations, tool: string): [string, JudgeEval][] {
  return Object.entries(evals)
    .filter(([, byTool]) => byTool[tool] && !byTool[tool].skipped)
    .map(([url, byTool]) => [url, byTool[tool]]);
}

// Micro-averaged over PRs: sum TP/FP/FN first, then divide.
export function scoreProfile(evals: Evaluations, tool: string, profile: ProfileName): Score {
  const cats = new Set<string>(PROFILES[profile]);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let prs = 0;
  for (const [, e] of toolEvals(evals, tool)) {
    tp += (e.true_positives ?? []).filter((t) => cats.has(t.category ?? '')).length;
    fn += (e.false_negatives ?? []).filter((f) => cats.has(f.category ?? '')).length;
    fp += e.fp ?? 0;
    prs += 1;
  }
  return { tp, fp, fn, prs, ...prf(tp, fp, fn) };
}

export type SeverityRecall = { severity: string; found: number; total: number; recall: number };

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

// Recall per golden severity. Precision per severity is undefined in this
// benchmark: a false positive has no golden severity.
export function recallBySeverity(
  evals: Evaluations,
  tool: string,
  profile: ProfileName,
): SeverityRecall[] {
  const cats = new Set<string>(PROFILES[profile]);
  const found = new Map<string, number>();
  const total = new Map<string, number>();
  for (const [, e] of toolEvals(evals, tool)) {
    for (const t of e.true_positives ?? []) {
      if (!cats.has(t.category ?? '')) continue;
      const s = t.severity ?? 'Unknown';
      found.set(s, (found.get(s) ?? 0) + 1);
      total.set(s, (total.get(s) ?? 0) + 1);
    }
    for (const f of e.false_negatives ?? []) {
      if (!cats.has(f.category ?? '')) continue;
      const s = f.severity ?? 'Unknown';
      total.set(s, (total.get(s) ?? 0) + 1);
    }
  }
  const names = [...SEVERITIES, ...[...total.keys()].filter((s) => !SEVERITIES.includes(s))];
  return names
    .filter((s) => total.has(s))
    .map((s) => ({
      severity: s,
      found: found.get(s) ?? 0,
      total: total.get(s) ?? 0,
      recall: ratio(found.get(s) ?? 0, total.get(s) ?? 0),
    }));
}

export type Summary = {
  label: string;
  tool: string;
  prsSelected: number;
  prsJudged: number;
  reviewErrors: { id: string; status: string; error?: string }[];
  judgeErrors: number; // judge comparisons that errored (from evaluations.json)
  profiles: Record<ProfileName, Score>;
  recallBySeverity: SeverityRecall[]; // core profile
  findings: {
    total: number;
    perPr: number;
    bySeverity: Record<string, number>;
    unverified: number;
    candidatesTotal: number; // after the judge's own extraction step
    candidatesPerPr: number;
  };
  cost: { reviewerUsd: number; judgeUsd: number; totalUsd: number; perPrUsd: number };
  durationMs: { reviewTotal: number; reviewPerPr: number };
};

export function summarize(input: {
  evals: Evaluations;
  tool: string;
  records: PrRecord[];
  judgeUsd: number;
}): Summary {
  const { evals, tool, records, judgeUsd } = input;
  const judged = toolEvals(evals, tool);
  const bySeverity: Record<string, number> = {};
  let total = 0;
  let unverified = 0;
  for (const r of records) {
    unverified += r.unverifiedFindings;
    for (const f of r.findings) {
      total += 1;
      bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    }
  }
  const candidatesTotal = judged.reduce((n, [, e]) => n + (e.total_candidates ?? 0), 0);
  const reviewerUsd = records.reduce((n, r) => n + r.costUsd, 0);
  const reviewTotal = records.reduce((n, r) => n + r.durationMs, 0);
  const n = records.length;
  return {
    label: 'self-run, not independently scored',
    tool,
    prsSelected: n,
    prsJudged: judged.length,
    reviewErrors: records
      .filter((r) => r.status !== 'findings' && r.status !== 'no_issues')
      .map((r) => ({ id: r.id, status: r.status, error: r.error })),
    judgeErrors: judged.reduce((k, [, e]) => k + (e.errors_count ?? 0), 0),
    profiles: {
      strict: scoreProfile(evals, tool, 'strict'),
      core: scoreProfile(evals, tool, 'core'),
      all: scoreProfile(evals, tool, 'all'),
    },
    recallBySeverity: recallBySeverity(evals, tool, 'core'),
    findings: {
      total,
      perPr: ratio(total, n),
      bySeverity,
      unverified,
      candidatesTotal,
      candidatesPerPr: ratio(candidatesTotal, judged.length),
    },
    cost: {
      reviewerUsd,
      judgeUsd,
      totalUsd: reviewerUsd + judgeUsd,
      perPrUsd: ratio(reviewerUsd + judgeUsd, n),
    },
    durationMs: { reviewTotal, reviewPerPr: ratio(reviewTotal, n) },
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;

export function renderSummary(s: Summary): string {
  const lines = [
    `Results: ${s.label}`,
    '',
    `PRs: ${s.prsSelected} selected, ${s.prsJudged} judged, ${s.reviewErrors.length} review error(s), ${s.judgeErrors} judge error(s)`,
    '',
    '| Profile | Precision | Recall | F1 | TP | FP | FN |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...(Object.keys(s.profiles) as ProfileName[]).map((p) => {
      const m = s.profiles[p];
      return `| ${p} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.tp} | ${m.fp} | ${m.fn} |`;
    }),
    '',
    '| Golden severity (core) | Found | Total | Recall |',
    '| --- | --- | --- | --- |',
    ...s.recallBySeverity.map(
      (r) => `| ${r.severity} | ${r.found} | ${r.total} | ${pct(r.recall)} |`,
    ),
    '',
    `Findings: ${s.findings.total} (${s.findings.perPr.toFixed(2)} per PR), ${s.findings.unverified} unverified and not sent to the judge`,
    `Judge candidates: ${s.findings.candidatesTotal} (${s.findings.candidatesPerPr.toFixed(2)} per judged PR)`,
    `Cost: reviewer ${usd(s.cost.reviewerUsd)}, judge ${usd(s.cost.judgeUsd)}, total ${usd(s.cost.totalUsd)} (${usd(s.cost.perPrUsd)} per PR)`,
    `Review time: ${(s.durationMs.reviewTotal / 1000).toFixed(0)}s total, ${(s.durationMs.reviewPerPr / 1000).toFixed(0)}s per PR`,
  ];
  for (const e of s.reviewErrors)
    lines.push(`Error: ${e.id}: ${e.status}${e.error ? ` (${e.error})` : ''}`);
  return lines.join('\n') + '\n';
}

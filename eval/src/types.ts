// Shared shapes for the evaluation harness. Benchmark-side shapes mirror the
// files written by withmartian/code-review-benchmark (offline pipeline).

export type ManifestPr = {
  id: string; // e.g. "sentry-93824", "discourse-graphite-4"
  source: string; // golden file stem: sentry, grafana, keycloak, discourse, cal_dot_com
  goldenUrl: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  baseRef: string;
  baseSha: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  goldenCount: number;
};

export type GoldenComment = { comment: string; severity?: string; category?: string };

export type GoldenEntry = {
  pr_title?: string;
  url: string;
  original_url?: string;
  az_comment?: string;
  comments: GoldenComment[];
  source_file: string;
};

export type ReviewComment = {
  path: string | null;
  line: number | null;
  body: string;
  created_at: string;
};

export type BenchmarkData = Record<
  string,
  {
    pr_title: string | null;
    original_url: string | null;
    source_repo: string;
    golden_comments: GoldenComment[];
    golden_source_file: string;
    az_comment: string | null;
    reviews: {
      tool: string;
      repo_name: string;
      pr_url: string;
      review_comments: ReviewComment[];
    }[];
  }
>;

export type Usage = {
  model: string; // as reported by the API
  requestedModel?: string; // as pinned in the eval config
  inputTokens: number;
  outputTokens: number;
  id?: string;
  effort?: string | null;
  stopReason?: string | null;
  ms?: number;
};

export type Price = { input: number; output: number }; // USD per million tokens

export type ReviewStatus =
  'findings' | 'no_issues' | 'unparseable' | 'input_mismatch' | 'run_failed' | 'not_run';

// One committed file per PR and run.
export type PrRecord = {
  id: string;
  goldenUrl: string;
  status: ReviewStatus;
  error?: string;
  promptSha256?: string;
  promptChars?: number;
  response?: string; // model output, verbatim
  findings: {
    severity: string;
    type: string;
    title: string;
    affected: string[];
    verified: boolean;
  }[];
  postedComments: number; // findings sent to the judge (verified only)
  unverifiedFindings: number;
  usage: Usage[]; // one entry per model call
  costUsd: number;
  durationMs: number;
  configHash?: string;
  judge?: JudgeEval; // the benchmark judge's verdict for this PR, verbatim
  judgeUsage?: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
};

// Per (PR, tool) entry of the judge's evaluations.json.
export type JudgeEval = {
  skipped?: boolean;
  tp?: number;
  fp?: number;
  fn?: number;
  total_candidates?: number;
  total_golden?: number;
  errors_count?: number;
  true_positives?: { golden_comment: string; severity?: string; category?: string }[];
  false_negatives?: { golden_comment: string; severity?: string; category?: string }[];
  false_positives?: unknown[];
};

export type Evaluations = Record<string, Record<string, JudgeEval>>;

export type EvalConfig = {
  name: string;
  budgetUsd: number; // total for the whole programme, across all runs
  benchmark: { repo: string; commit: string };
  tool: string;
  reviewer: {
    runner: string;
    model: string;
    effort: string;
    maxTokens: number;
    reviewArgs: string[];
  };
  judge: { model: string; baseUrl: string; apiKeyEnv: string };
  split: { seed: number; devPerSource: number };
  pricingUsdPerMTok: Record<string, Price>;
  // Assumptions behind the pre-run estimate. `low` / `high` name the cheap and
  // the expensive end of the range.
  estimate: {
    basis: string; // where the numbers come from
    promptCharsPerToken: { low: number; high: number };
    reviewerOutputTokens: { low: number; high: number };
    candidatesPerPr: { low: number; high: number };
    judgeCallTokens: { input: number; output: number };
    extractDedupTokens: { input: number; output: number };
  };
};

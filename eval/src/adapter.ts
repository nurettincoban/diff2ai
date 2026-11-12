import { parseAffected, parseFindings, reportsNoIssues } from '../../src/formatters/findings.js';
import type { Finding } from '../../src/formatters/findings.js';
import { formatInlineComment } from '../../src/integrations/format.js';
import type {
  BenchmarkData,
  GoldenEntry,
  ManifestPr,
  PrRecord,
  ReviewComment,
  ReviewStatus,
} from './types.js';

export type Classified = {
  status: Extract<ReviewStatus, 'findings' | 'no_issues' | 'unparseable'>;
  findings: Finding[];
};

// A response is usable when it has issue blocks or the explicit "nothing
// found" sentence. Anything else is model chatter and must surface as an
// error instead of looking like a clean review.
export function classifyOutput(markdown: string): Classified {
  const findings = parseFindings(markdown);
  if (findings.length > 0) return { status: 'findings', findings };
  if (reportsNoIssues(markdown)) return { status: 'no_issues', findings: [] };
  return { status: 'unparseable', findings: [] };
}

// One GitHub-style review comment per finding, with the body `diff2ai post`
// would put on the PR. Findings that failed the local diff verification are
// left out, as `post` does by default.
export function toReviewComments(findings: Finding[], createdAt: string): ReviewComment[] {
  return findings
    .filter((f) => !f.verificationFailed)
    .map((f) => {
      const loc = f.affected.map((a) => parseAffected(a)).find((r) => r !== null) ?? null;
      return {
        path: loc ? loc.path.replace(/\\/g, '/') : null,
        // GitHub's `line` is the last line of a multi-line comment range
        line: loc?.end ?? loc?.start ?? null,
        body: formatInlineComment(f),
        created_at: createdAt,
      };
    });
}

export function findingSummaries(findings: Finding[]): PrRecord['findings'] {
  return findings.map((f) => ({
    severity: f.severity,
    type: f.type,
    title: f.title,
    affected: f.affected,
    verified: !f.verificationFailed,
  }));
}

export type AdapterItem = {
  pr: ManifestPr;
  golden: GoldenEntry;
  comments: ReviewComment[]; // empty for clean reviews and for failed runs
};

// Same shape as the benchmark's step1 output (results/benchmark_data.json),
// restricted to one tool. Golden comments are passed through untouched.
export function buildBenchmarkData(items: AdapterItem[], tool: string): BenchmarkData {
  const out: BenchmarkData = {};
  for (const { pr, golden, comments } of items) {
    out[golden.url] = {
      pr_title: golden.pr_title ?? null,
      original_url: golden.original_url ?? null,
      source_repo: pr.repo,
      golden_comments: golden.comments,
      golden_source_file: golden.source_file,
      az_comment: golden.az_comment ?? null,
      reviews: [
        {
          tool,
          repo_name: `${pr.owner}/${pr.repo}`,
          pr_url: golden.url,
          review_comments: comments,
        },
      ],
    };
  }
  return out;
}

// JSON with every non-ASCII character escaped. The benchmark's Python scripts
// open files with the platform default encoding, which is not UTF-8 on Windows.
export function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[\u0080-￿]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

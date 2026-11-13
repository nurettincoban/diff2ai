import { describe, it, expect } from 'vitest';
import { parseFindings } from '../src/formatters/findings.js';
import { formatInlineComment } from '../src/integrations/format.js';
import {
  asciiJson,
  buildBenchmarkData,
  classifyOutput,
  findingSummaries,
  toReviewComments,
} from '../eval/src/adapter.js';
import type { GoldenEntry, ManifestPr } from '../eval/src/types.js';

// Adapter between diff2ai's review output and the benchmark judge's input.
// Pure functions, no network, no git.

const REVIEW = `## 1) Severity: HIGH | Type: Bug
Title: Guard against a missing member

Affected:
- src/api/audit.py:70-74

Explanation:
\`member\` is None for API-key requests, so this raises AttributeError.

Proposed fix:
~~~python
if member is None:
    return False
~~~

## 2) Severity: LOW | Type: Style
Verification: failed — file is not part of the change
Title: Rename the helper

Affected:
- src/other.py:3

Explanation:
Naming.

## 3) Severity: MEDIUM | Type: Performance
Title: Avoid the extra query

Explanation:
No location was given for this one.
`;

const pr: ManifestPr = {
  id: 'sentry-1',
  source: 'sentry',
  goldenUrl: 'https://github.com/getsentry/sentry/pull/1',
  owner: 'getsentry',
  repo: 'sentry',
  number: 1,
  title: 't',
  baseRef: 'master',
  baseSha: 'a',
  headSha: 'b',
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  goldenCount: 1,
};

const golden: GoldenEntry = {
  pr_title: 'Audit log pagination',
  url: pr.goldenUrl,
  az_comment: 'note',
  comments: [{ comment: 'member can be None — crash', severity: 'High', category: 'bug' }],
  source_file: 'sentry.json',
};

describe('classifyOutput', () => {
  it('returns findings when issue blocks are present', () => {
    const out = classifyOutput(REVIEW);
    expect(out.status).toBe('findings');
    expect(out.findings).toHaveLength(3);
  });

  it('recognises an explicit clean review', () => {
    expect(classifyOutput('No issues found.\n').status).toBe('no_issues');
  });

  it('flags chatter without issue blocks as unparseable, not as a clean review', () => {
    expect(classifyOutput('Sure! Here is my review of the diff...').status).toBe('unparseable');
    expect(classifyOutput('').status).toBe('unparseable');
  });
});

describe('toReviewComments', () => {
  const findings = parseFindings(REVIEW);
  const comments = toReviewComments(findings, '2026-01-01T00:00:00.000Z');

  it('drops findings that failed verification, as `post` does', () => {
    expect(comments).toHaveLength(2);
    expect(comments.map((c) => c.body).join('\n')).not.toContain('Rename the helper');
  });

  it('anchors a comment at the last line of the first affected range', () => {
    expect(comments[0].path).toBe('src/api/audit.py');
    expect(comments[0].line).toBe(74);
    expect(comments[0].created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('uses the same body `diff2ai post` writes inline', () => {
    expect(comments[0].body).toBe(formatInlineComment(findings[0]));
    expect(comments[0].body).toContain('Guard against a missing member');
    expect(comments[0].body).toContain('Proposed fix');
  });

  it('keeps findings without a location, unanchored', () => {
    expect(comments[1].path).toBeNull();
    expect(comments[1].line).toBeNull();
  });

  it('summarises every finding, including unverified ones', () => {
    const summary = findingSummaries(findings);
    expect(summary.map((f) => f.verified)).toEqual([true, false, true]);
    expect(summary[0]).toMatchObject({ severity: 'HIGH', type: 'Bug' });
  });
});

describe('buildBenchmarkData', () => {
  const comments = toReviewComments(parseFindings(REVIEW), '2026-01-01T00:00:00.000Z');
  const data = buildBenchmarkData([{ pr, golden, comments }], 'diff2ai');
  const entry = data[pr.goldenUrl];

  it('is keyed by the golden URL and carries one review for the tool', () => {
    expect(Object.keys(data)).toEqual([pr.goldenUrl]);
    expect(entry.reviews).toHaveLength(1);
    expect(entry.reviews[0].tool).toBe('diff2ai');
    expect(entry.reviews[0].review_comments).toEqual(comments);
  });

  it('passes golden comments through untouched', () => {
    expect(entry.golden_comments).toBe(golden.comments);
    expect(entry.golden_source_file).toBe('sentry.json');
    expect(entry.az_comment).toBe('note');
    expect(entry.original_url).toBeNull();
  });

  it('keeps a PR with no comments so the judge counts its golden comments as missed', () => {
    const empty = buildBenchmarkData([{ pr, golden, comments: [] }], 'diff2ai');
    expect(empty[pr.goldenUrl].reviews[0].review_comments).toEqual([]);
  });
});

describe('asciiJson', () => {
  it('escapes non-ASCII text and round-trips', () => {
    const value = { body: '🟧 HIGH — member can’t be None' };
    const text = asciiJson(value);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
    expect(JSON.parse(text)).toEqual(value);
  });
});

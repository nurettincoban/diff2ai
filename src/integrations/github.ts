import { runCommandCapture, type CommandCapture } from '../runners/execute.js';
import { parseAffected, type Finding } from '../formatters/findings.js';
import { buildDiffIndex, type DiffIndex } from '../git/diffParse.js';
import { matchDiffPath } from '../orchestrator/verify.js';
import {
  commentFooter,
  commentHeading,
  findingDetails,
  formatInlineComment,
  formatSummaryComment,
  severityCounts,
  sortBySeverity,
} from './format.js';

// All GitHub traffic goes through the user's authenticated `gh` CLI; diff2ai
// itself never talks to the network or handles tokens.
export type GithubConfig = {
  command?: string; // defaults to "gh"; overridable for tests/wrappers
  args?: string[]; // always prepended
};

async function gh(
  cfg: GithubConfig | undefined,
  args: string[],
  input?: string,
): Promise<CommandCapture> {
  const command = cfg?.command ?? 'gh';
  const base = Array.isArray(cfg?.args) ? cfg.args : [];
  return runCommandCapture(command, [...base, ...args], input === undefined ? {} : { input });
}

function ghError(cfg: GithubConfig | undefined, res: CommandCapture, what: string): Error {
  const command = cfg?.command ?? 'gh';
  if (!res.ok && res.notFound) {
    return new Error(
      `"${command}" not found on PATH. Install the GitHub CLI (https://cli.github.com) and run "gh auth login" first.`,
    );
  }
  const detail = res.stderr.trim() || res.stdout.trim() || '(no output)';
  return new Error(`${what} failed (${command}): ${detail}`);
}

// PR number for the current branch (gh resolves it from the checked-out branch).
export async function currentPrNumber(cfg?: GithubConfig): Promise<number> {
  const res = await gh(cfg, ['pr', 'view', '--json', 'number', '--jq', '.number']);
  const n = res.ok ? Number.parseInt(res.stdout.trim(), 10) : NaN;
  if (!Number.isInteger(n)) {
    throw res.ok
      ? new Error('No pull request found for the current branch. Pass --pr <number>.')
      : ghError(cfg, res, 'Looking up the PR for the current branch');
  }
  return n;
}

// Base branch of a PR, or null when gh is unavailable (best effort).
export async function prBaseBranch(pr: number, cfg?: GithubConfig): Promise<string | null> {
  const res = await gh(cfg, [
    'pr',
    'view',
    String(pr),
    '--json',
    'baseRefName',
    '--jq',
    '.baseRefName',
  ]);
  const name = res.ok ? res.stdout.trim() : '';
  return name || null;
}

export async function prDiff(pr: number, cfg?: GithubConfig): Promise<string> {
  const res = await gh(cfg, ['pr', 'diff', String(pr), '--color', 'never']);
  if (!res.ok) throw ghError(cfg, res, `Fetching the diff of PR #${pr}`);
  return res.stdout;
}

export type ReviewComment = {
  path: string;
  line: number;
  side: 'RIGHT';
  start_line?: number;
  start_side?: 'RIGHT';
  body: string;
};

// GitHub rejects a whole review (422) if any comment points at a line outside
// the PR diff, so only findings whose lines fall inside a hunk are anchored;
// the rest go into the review body.
export function planInlineComments(
  findings: Finding[],
  index: DiffIndex,
): { inline: ReviewComment[]; rest: Finding[] } {
  const inline: ReviewComment[] = [];
  const rest: Finding[] = [];
  for (const f of findings) {
    let comment: ReviewComment | null = null;
    for (const entry of f.affected) {
      const ref = parseAffected(entry);
      if (!ref || ref.start === undefined) continue;
      const diffPath = matchDiffPath(index, ref.path);
      if (!diffPath) continue;
      const end = ref.end ?? ref.start;
      const hunk = index.get(diffPath)!.find(([hs, he]) => ref.start! <= he && end >= hs);
      if (!hunk) continue;
      const startLine = Math.max(ref.start, hunk[0]);
      const endLine = Math.min(end, hunk[1]);
      comment = { path: diffPath, line: endLine, side: 'RIGHT', body: formatInlineComment(f) };
      if (startLine < endLine) {
        comment.start_line = startLine;
        comment.start_side = 'RIGHT';
      }
      break;
    }
    if (comment) inline.push(comment);
    else rest.push(f);
  }
  return { inline, rest };
}

export function formatReviewBody(
  all: Finding[],
  rest: Finding[],
  inlineCount: number,
  source?: string,
): string {
  const lines = [
    commentHeading(all),
    '',
    `**${all.length} finding(s)** — ${severityCounts(all)}${inlineCount > 0 ? ` · ${inlineCount} posted as inline comments` : ''}`,
    '',
  ];
  if (rest.length > 0) {
    if (inlineCount > 0) lines.push('Findings that could not be anchored to a changed line:', '');
    sortBySeverity(rest).forEach((f, i) => lines.push(...findingDetails(f, i + 1)));
  }
  lines.push('---', '', commentFooter(all, source));
  return lines.join('\n');
}

export type GithubPostResult = {
  mode: 'review' | 'comment';
  inline: number;
  fellBack?: string; // why a review with inline comments was not possible
  output: string;
};

export async function postPrComment(body: string, pr: number, cfg?: GithubConfig): Promise<string> {
  const res = await gh(cfg, ['pr', 'comment', String(pr), '--body-file', '-'], body);
  if (!res.ok) throw ghError(cfg, res, `Commenting on PR #${pr}`);
  return res.stdout.trim();
}

// Posts one PR review: findings on changed lines become inline comments, the
// rest are listed in the review body. Falls back to a single PR comment when
// the review cannot be created.
export async function postPrReview(
  findings: Finding[],
  pr: number,
  opts: { cfg?: GithubConfig; source?: string; inline?: boolean } = {},
): Promise<GithubPostResult> {
  const sorted = sortBySeverity(findings);
  if (opts.inline === false) {
    const output = await postPrComment(formatSummaryComment(sorted, opts), pr, opts.cfg);
    return { mode: 'comment', inline: 0, output };
  }

  let fellBack: string;
  try {
    const { inline, rest } = planInlineComments(sorted, buildDiffIndex(await prDiff(pr, opts.cfg)));
    const payload = {
      event: 'COMMENT',
      body: formatReviewBody(sorted, rest, inline.length, opts.source),
      comments: inline,
    };
    const res = await gh(
      opts.cfg,
      ['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${pr}/reviews`, '--input', '-'],
      JSON.stringify(payload),
    );
    if (res.ok) {
      let url = '';
      try {
        url = (JSON.parse(res.stdout) as { html_url?: string }).html_url ?? '';
      } catch {
        // gh output is not JSON (e.g. wrapper); ignore
      }
      return { mode: 'review', inline: inline.length, output: url };
    }
    if (res.notFound) throw ghError(opts.cfg, res, 'Creating the review');
    fellBack = ghError(opts.cfg, res, 'Creating the review').message;
  } catch (error) {
    if (/not found on PATH/.test((error as Error).message)) throw error;
    fellBack = (error as Error).message;
  }
  const output = await postPrComment(formatSummaryComment(sorted, opts), pr, opts.cfg);
  return { mode: 'comment', inline: 0, fellBack, output };
}

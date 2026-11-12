import fs from 'node:fs';
import path from 'node:path';
import { findLatestReview } from '../../src/formatters/reviewFile.js';
import { classifyOutput, findingSummaries, toReviewComments } from './adapter.js';
import { paths, sha256 } from './config.js';
import { usageCostUsd } from './cost.js';
import { lastLines, runProc } from './proc.js';
import { preparePr, type PreparedPr } from './repos.js';
import type { EvalConfig, ManifestPr, PrRecord, ReviewComment, Usage } from './types.js';

export type RunContext = {
  config: EvalConfig;
  workDir: string; // scratch output of the diff2ai CLI (prompts embed third-party code; never committed)
  aidiff: string; // contents of the .aidiff.json written into each PR repo
};

function freshDir(dir: string): string {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function promptFileFor(outDir: string, reviewFile: string | null): string | null {
  if (reviewFile?.endsWith('.response.md')) return reviewFile.replace(/\.response\.md$/, '.md');
  if (reviewFile) return path.join(path.dirname(reviewFile), 'prompt.md'); // consensus run
  const prompts = fs.readdirSync(outDir).filter((f) => /^review_.*\.md$/.test(f));
  return prompts.length > 0 ? path.join(outDir, prompts[0]) : null;
}

async function diff2ai(prep: PreparedPr, outDir: string, extra: string[], env: NodeJS.ProcessEnv) {
  return runProc(
    process.execPath,
    [
      paths.cli,
      '--no-interactive',
      '--yes',
      'review',
      prep.ref,
      '--target',
      prep.target,
      '--out',
      outDir,
      ...extra,
    ],
    { cwd: prep.repoDir, env },
  );
}

// Renders the review prompt without calling any model (free). Used for the
// pre-run cost estimate.
export async function renderPrompt(
  pr: ManifestPr,
  ctx: RunContext,
): Promise<{ chars: number; mismatch?: string }> {
  const prep = await preparePr(pr, ctx.aidiff);
  const outDir = freshDir(path.join(ctx.workDir, 'estimate', pr.id));
  const res = await diff2ai(prep, outDir, [], process.env);
  const prompt = promptFileFor(outDir, null);
  if (res.code !== 0 || !prompt) {
    throw new Error(`could not render the prompt: ${lastLines(res.stdout + res.stderr, 3)}`);
  }
  return { chars: fs.readFileSync(prompt, 'utf-8').length, mismatch: prep.mismatch };
}

function readUsage(file: string): Usage[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Usage);
}

export type Reviewed = { record: PrRecord; comments: ReviewComment[] };

// Runs one headless diff2ai review and turns its output into a record plus the
// comments handed to the judge. Never throws: every failure becomes a status.
export async function reviewPr(pr: ManifestPr, ctx: RunContext): Promise<Reviewed> {
  const base: PrRecord = {
    id: pr.id,
    goldenUrl: pr.goldenUrl,
    status: 'run_failed',
    findings: [],
    postedComments: 0,
    unverifiedFindings: 0,
    usage: [],
    costUsd: 0,
    durationMs: 0,
  };
  const started = Date.now();
  const done = (patch: Partial<PrRecord>, comments: ReviewComment[] = []): Reviewed => ({
    record: { ...base, ...patch, durationMs: Date.now() - started },
    comments,
  });

  let prep: PreparedPr;
  try {
    prep = await preparePr(pr, ctx.aidiff);
  } catch (error) {
    return done({ error: `checkout failed: ${(error as Error).message.trim()}` });
  }
  if (prep.mismatch) return done({ status: 'input_mismatch', error: prep.mismatch });

  const outDir = freshDir(path.join(ctx.workDir, 'review', pr.id));
  const usageFile = path.join(outDir, 'usage.jsonl');
  const res = await diff2ai(
    prep,
    outDir,
    ['--run', ctx.config.reviewer.runner, ...ctx.config.reviewer.reviewArgs],
    { ...process.env, DIFF2AI_EVAL_USAGE_FILE: usageFile },
  );
  const usage = readUsage(usageFile);
  const spent = { usage, costUsd: usageCostUsd(ctx.config, usage) };

  const reviewFile = findLatestReview(outDir);
  const promptFile = promptFileFor(outDir, reviewFile);
  const prompt =
    promptFile && fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf-8') : null;
  const promptInfo = prompt ? { promptSha256: sha256(prompt), promptChars: prompt.length } : {};

  if (res.code !== 0 || !reviewFile) {
    return done({ ...spent, ...promptInfo, error: lastLines(res.stdout + res.stderr, 3) });
  }
  const response = fs.readFileSync(reviewFile, 'utf-8');
  const { status, findings } = classifyOutput(response);
  const comments = toReviewComments(findings, new Date().toISOString());
  return done(
    {
      ...spent,
      ...promptInfo,
      status,
      response,
      error:
        status === 'unparseable'
          ? 'model output has no issue blocks and no "No issues found."'
          : undefined,
      findings: findingSummaries(findings),
      postedComments: comments.length,
      unverifiedFindings: findings.length - comments.length,
    },
    comments,
  );
}

// PRs of one repository share a cached clone whose branches are re-pointed per
// PR, so they run in sequence; different repositories run side by side.
export async function inRepoLanes<T>(
  prs: ManifestPr[],
  worker: (pr: ManifestPr) => Promise<T>,
): Promise<Map<string, T>> {
  const lanes = new Map<string, ManifestPr[]>();
  for (const pr of prs) {
    const key = `${pr.owner}/${pr.repo}`;
    lanes.set(key, [...(lanes.get(key) ?? []), pr]);
  }
  const out = new Map<string, T>();
  await Promise.all(
    [...lanes.values()].map(async (lane) => {
      for (const pr of lane) out.set(pr.id, await worker(pr));
    }),
  );
  return out;
}

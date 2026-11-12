// npm run eval -- --subset <ids> | --split dev|heldout | --all
//                 [--estimate] [--approve-usd <n>] [--mock] [--run-id <name>] [--config <file>]
import fs from 'node:fs';
import path from 'node:path';
import { gitClient } from '../../src/git/repo.js';
import { asciiJson, buildBenchmarkData, type AdapterItem } from './adapter.js';
import { ensureBenchmark, loadGolden } from './benchmark.js';
import {
  configHash,
  loadConfig,
  loadManifest,
  paths,
  renderAidiffConfig,
  selectPrs,
} from './config.js';
import { capUsd, estimateRun, overCap, priceFor, renderEstimate } from './cost.js';
import { runJudge } from './judge.js';
import { renderSummary, summarize } from './metrics.js';
import { mockUpstream } from './mock.js';
import { inRepoLanes, renderPrompt, reviewPr, type Reviewed, type RunContext } from './pipeline.js';
import { httpUpstream, startProxy, usageByPr } from './proxy.js';
import type { PrRecord } from './types.js';

type Args = {
  subset?: string[];
  split?: 'dev' | 'heldout';
  all: boolean;
  estimate: boolean;
  mock: boolean;
  approveUsd?: number;
  runId: string;
  config: string;
};

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const split = value('--split');
  if (split && split !== 'dev' && split !== 'heldout')
    throw new Error('--split must be dev or heldout.');
  const approve = value('--approve-usd');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return {
    subset: value('--subset')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    split: split as Args['split'],
    all: argv.includes('--all'),
    estimate: argv.includes('--estimate'),
    mock: argv.includes('--mock'),
    approveUsd: approve === undefined ? undefined : Number(approve),
    runId: value('--run-id') ?? stamp,
    config: value('--config') ?? 'eval/config/baseline.json',
  };
}

const writeJson = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf-8');

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const prs = selectPrs(loadManifest(), args);
  if (!fs.existsSync(paths.cli)) throw new Error('dist/cli.js is missing. Run: npm run build');
  const startedAt = new Date();

  const offlineDir = await ensureBenchmark(config);
  const golden = loadGolden(offlineDir);
  for (const pr of prs) {
    if (golden.get(pr.goldenUrl)?.comments.length !== pr.goldenCount) {
      throw new Error(
        `${pr.id}: golden comments differ from the manifest. Rebuild it for this pin.`,
      );
    }
  }
  const ctx: RunContext = {
    config,
    workDir: path.join(paths.cache, 'work', args.runId),
    aidiff: renderAidiffConfig(config, args.mock ? paths.fakeRunner : paths.evalRunner),
  };

  // 1. Estimate from locally rendered prompts. No model is called here.
  console.log(`Preparing ${prs.length} PR(s) and rendering prompts (no API calls)...`);
  const rendered = await inRepoLanes(prs, (pr) =>
    renderPrompt(pr, ctx).catch((error: Error) => ({ chars: 0, mismatch: error.message })),
  );
  for (const pr of prs) {
    const r = rendered.get(pr.id);
    if (r?.mismatch) console.log(`  ! ${pr.id}: ${r.mismatch}`);
  }
  const estimate = estimateRun(
    config,
    prs.map((pr) => ({ chars: rendered.get(pr.id)?.chars ?? 0, goldenCount: pr.goldenCount })),
  );
  console.log(renderEstimate(estimate, config));
  if (args.estimate) return;

  const apiKey = args.mock ? 'mock' : (process.env[config.judge.apiKeyEnv] ?? '');
  if (!args.mock) {
    if (args.approveUsd === undefined || !(args.approveUsd > 0)) {
      console.log(
        '\nNothing was run. Re-run with --approve-usd <amount> once the estimate is approved.',
      );
      return;
    }
    if (!apiKey) throw new Error(`${config.judge.apiKeyEnv} is not set in the environment.`);
  }
  const approved = args.mock ? Number.POSITIVE_INFINITY : (args.approveUsd as number);
  const runDir = path.join(args.mock ? path.join(paths.cache, 'mock') : paths.results, args.runId);
  if (fs.existsSync(runDir)) throw new Error(`Run directory already exists: ${runDir}`);
  fs.mkdirSync(path.join(runDir, 'prs'), { recursive: true });
  const hash = configHash(config);

  // 2. Reviews. Spend is checked before each PR starts.
  let spent = 0;
  const reviewed = await inRepoLanes(prs, async (pr): Promise<Reviewed> => {
    if (overCap(spent, approved)) {
      const record: PrRecord = {
        id: pr.id,
        goldenUrl: pr.goldenUrl,
        status: 'not_run',
        error: 'cost cap reached before this PR started',
        findings: [],
        postedComments: 0,
        unverifiedFindings: 0,
        usage: [],
        costUsd: 0,
        durationMs: 0,
      };
      return { record, comments: [] };
    }
    const out = await reviewPr(pr, ctx);
    spent += out.record.costUsd;
    console.log(
      `  ${pr.id}: ${out.record.status}, ${out.record.findings.length} finding(s), $${out.record.costUsd.toFixed(3)}, ${Math.round(out.record.durationMs / 1000)}s`,
    );
    return out;
  });
  const records = prs.map((pr) => ({
    ...(reviewed.get(pr.id) as Reviewed).record,
    configHash: hash,
  }));
  const saveRecords = () =>
    records.forEach((r) => writeJson(path.join(runDir, 'prs', `${r.id}.json`), r));
  saveRecords();

  // 3. The benchmark's own judge, unmodified, through the logging proxy.
  const judgeDir = path.join(runDir, 'judge');
  fs.mkdirSync(path.join(judgeDir, 'results'), { recursive: true });
  const items: AdapterItem[] = prs.map((pr) => ({
    pr,
    golden: golden.get(pr.goldenUrl)!,
    comments: (reviewed.get(pr.id) as Reviewed).comments,
  }));
  fs.writeFileSync(
    path.join(judgeDir, 'results', 'benchmark_data.json'),
    asciiJson(buildBenchmarkData(items, config.tool)) + '\n',
    'utf-8',
  );
  const judgePrice = priceFor(config, config.judge.model);
  let killJudge: (() => void) | undefined;
  const proxy = await startProxy({
    upstream: args.mock ? mockUpstream : httpUpstream(config.judge.baseUrl),
    logFile: path.join(judgeDir, 'calls.jsonl'),
    price: judgePrice,
    capUsd: capUsd(approved) - spent,
    needles: items.flatMap(({ pr, golden: g, comments }) => [
      ...g.comments.map((c) => ({ kind: 'judge' as const, text: c.comment, pr: pr.id })),
      ...comments.map((c) => ({ kind: 'extract' as const, text: c.body.slice(0, 200), pr: pr.id })),
    ]),
    onCap: () => killJudge?.(),
  });
  console.log(`Running the benchmark judge (${config.judge.model})...`);
  const judge = overCap(spent, approved)
    ? null
    : await runJudge({
        offlineDir,
        judgeDir,
        tool: config.tool,
        model: config.judge.model,
        baseUrl: proxy.url,
        apiKey,
        onSpawn: (kill) => (killJudge = kill),
      });
  await proxy.close();
  for (const step of judge?.steps ?? []) {
    console.log(
      `  ${step.name}: exit ${step.code}, ${Math.round(step.ms / 1000)}s${step.code === 0 ? '' : ` — ${step.tail}`}`,
    );
  }
  if (judge?.scoreProfiles)
    fs.writeFileSync(path.join(judgeDir, 'score_profiles.txt'), judge.scoreProfiles);

  // 4. Records, summary, run metadata.
  const evals = judge?.evaluations ?? {};
  const perPr = usageByPr(proxy.calls, judgePrice);
  for (const r of records) {
    r.judge = evals[r.goldenUrl]?.[config.tool];
    r.judgeUsage = perPr.get(r.id);
  }
  saveRecords();
  const summary = summarize({ evals, tool: config.tool, records, judgeUsd: proxy.spentUsd() });
  const root = gitClient(paths.root);
  const dirty = (
    await root.raw([
      'status',
      '--porcelain',
      '--',
      'src',
      'templates',
      'eval/src',
      'eval/config',
      'package.json',
    ])
  ).trim();
  writeJson(path.join(runDir, 'summary.json'), summary);
  fs.writeFileSync(path.join(runDir, 'summary.md'), renderSummary(summary), 'utf-8');
  writeJson(path.join(runDir, 'run.json'), {
    runId: args.runId,
    label: summary.label,
    mock: args.mock,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    wallMs: Date.now() - startedAt.getTime(),
    prs: prs.map((p) => p.id),
    configFile: args.config,
    configHash: hash,
    config,
    diff2ai: {
      commit: (await root.revparse(['HEAD'])).trim(),
      uncommittedChanges: dirty ? dirty.split('\n') : [],
    },
    benchmarkCommit: config.benchmark.commit,
    approvedUsd: args.mock ? null : approved,
    estimate,
    stoppedByCostCap: overCap(spent, approved) || proxy.capReached(),
    judge: {
      ok: judge?.ok ?? false,
      steps: judge?.steps ?? [],
      calls: proxy.calls.length,
      unattributedCalls: perPr.get('(unattributed)')?.calls ?? 0,
    },
    environment: { node: process.version, platform: process.platform },
  });
  console.log(`\n${renderSummary(summary)}`);
  console.log(`Wall time: ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s`);
  console.log(
    `Run written to ${path.relative(paths.root, runDir)}${args.mock ? ' (mock run: not a result)' : ''}`,
  );
  if (!judge?.ok) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

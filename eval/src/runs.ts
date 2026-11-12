import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { modelDirName } from './judge.js';
import { summarize, type Summary } from './metrics.js';
import type { EvalConfig, Evaluations, PrRecord } from './types.js';

// A committed run under eval/results/, as read back from disk.
export type Run = {
  id: string;
  config: EvalConfig;
  evals: Evaluations;
  records: Map<string, PrRecord>;
};

export function loadRun(id: string): Run {
  const dir = path.join(paths.results, id);
  if (!fs.existsSync(path.join(dir, 'run.json')))
    throw new Error(`No run "${id}" in eval/results.`);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf-8')) as {
    config: EvalConfig;
  };
  const evals = JSON.parse(
    fs.readFileSync(
      path.join(dir, 'judge', 'results', modelDirName(meta.config.judge.model), 'evaluations.json'),
      'utf-8',
    ),
  ) as Evaluations;
  const records = new Map<string, PrRecord>();
  for (const file of fs.readdirSync(path.join(dir, 'prs'))) {
    const record = JSON.parse(fs.readFileSync(path.join(dir, 'prs', file), 'utf-8')) as PrRecord;
    records.set(record.id, record);
  }
  return { id, config: meta.config, evals, records };
}

// The run's summary restricted to the given PRs: judge verdicts, records and
// the judge cost attributed to those PRs.
export function subsetSummary(run: Run, ids: string[], urlOf: Map<string, string>): Summary {
  const evals: Evaluations = {};
  const records: PrRecord[] = [];
  for (const id of ids) {
    const record = run.records.get(id);
    if (!record) throw new Error(`Run ${run.id} has no record for ${id}.`);
    records.push(record);
    const url = urlOf.get(id) as string;
    if (run.evals[url]) evals[url] = run.evals[url];
  }
  const judgeUsd = records.reduce((n, r) => n + (r.judgeUsage?.costUsd ?? 0), 0);
  return summarize({ evals, tool: run.config.tool, records, judgeUsd });
}

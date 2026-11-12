import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalConfig, ManifestPr } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const paths = {
  root: path.resolve(here, '..', '..'),
  evalDir: path.resolve(here, '..'),
  cache: path.resolve(here, '..', '.cache'),
  results: path.resolve(here, '..', 'results'),
  manifest: path.resolve(here, '..', 'manifest.json'),
  split: path.resolve(here, '..', 'split.json'),
  aidiffTemplate: path.resolve(here, '..', 'config', 'aidiff.eval.json'),
  evalRunner: path.resolve(here, 'runner', 'anthropic-runner.mjs'),
  fakeRunner: path.resolve(here, '..', '..', 'tests', 'fixtures', 'fake-runner.mjs'),
  cli: path.resolve(here, '..', '..', 'dist', 'cli.js'),
  defaultTemplate: path.resolve(here, '..', '..', 'templates', 'default.md'),
};

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export function loadConfig(file: string): EvalConfig {
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) throw new Error(`Eval config not found: ${abs}`);
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as EvalConfig;
}

export function loadManifest(): ManifestPr[] {
  if (!fs.existsSync(paths.manifest)) {
    throw new Error('eval/manifest.json is missing. Generate it with: npm run eval:manifest');
  }
  return JSON.parse(fs.readFileSync(paths.manifest, 'utf-8')) as ManifestPr[];
}

export type Split = { seed: number; dev: string[]; heldout: string[] };

export function loadSplit(): Split {
  if (!fs.existsSync(paths.split)) throw new Error('eval/split.json is missing.');
  return JSON.parse(fs.readFileSync(paths.split, 'utf-8')) as Split;
}

// Money already spent: the total cost recorded by every committed run.
export function priorSpendUsd(resultsDir: string = paths.results): number {
  if (!fs.existsSync(resultsDir)) return 0;
  let total = 0;
  for (const run of fs.readdirSync(resultsDir)) {
    const file = path.join(resultsDir, run, 'summary.json');
    if (!fs.existsSync(file)) continue;
    const summary = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      cost?: { totalUsd?: number };
    };
    total += summary.cost?.totalUsd ?? 0;
  }
  return total;
}

// "sentry-93824", "cal.com-8087", "discourse-graphite-4"
export function prId(repo: string, number: number): string {
  return `${repo.toLowerCase()}-${number}`;
}

export function selectPrs(
  manifest: ManifestPr[],
  sel: { subset?: string[]; all?: boolean; split?: 'dev' | 'heldout' },
): ManifestPr[] {
  if (sel.all) return manifest;
  const ids = sel.split ? loadSplit()[sel.split] : (sel.subset ?? []);
  if (ids.length === 0)
    throw new Error('Select PRs with --subset <ids>, --split dev|heldout, or --all.');
  const byId = new Map(manifest.map((p) => [p.id, p]));
  return ids.map((id) => {
    const pr = byId.get(id);
    if (!pr) throw new Error(`Unknown PR id "${id}". See eval/manifest.json for valid ids.`);
    return pr;
  });
}

// The .aidiff.json written into each PR work repo: the committed template with
// the runner path and reviewer settings filled in.
export function renderAidiffConfig(config: EvalConfig, runnerPath: string): string {
  const fill: Record<string, string> = {
    '{evalRunner}': runnerPath.replace(/\\/g, '/'),
    '{model}': config.reviewer.model,
    '{effort}': config.reviewer.effort,
    '{maxTokens}': String(config.reviewer.maxTokens),
  };
  let text = fs.readFileSync(paths.aidiffTemplate, 'utf-8');
  for (const [key, value] of Object.entries(fill)) text = text.split(key).join(value);
  return text;
}

// Everything that defines the system under test, independent of machine paths.
export function configHash(config: EvalConfig): string {
  return sha256(
    JSON.stringify({
      // Budget, prices and estimate assumptions do not change what is measured
      benchmark: config.benchmark,
      tool: config.tool,
      reviewer: config.reviewer,
      post: config.post,
      judge: config.judge,
      aidiff: fs.readFileSync(paths.aidiffTemplate, 'utf-8'),
      template: fs.readFileSync(paths.defaultTemplate, 'utf-8'),
      runner: fs.readFileSync(paths.evalRunner, 'utf-8'),
    }),
  );
}

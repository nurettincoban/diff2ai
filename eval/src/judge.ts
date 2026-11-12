import fs from 'node:fs';
import path from 'node:path';
import { lastLines, runProc } from './proc.js';
import type { Evaluations } from './types.js';

export type JudgeStep = { name: string; code: number | null; ms: number; tail: string };

export type JudgeResult = {
  ok: boolean;
  steps: JudgeStep[];
  modelDir: string; // results/<model> as created by the pipeline
  evaluations: Evaluations | null;
  scoreProfiles: string; // stdout of the benchmark's own scoring script
};

export type JudgeOptions = {
  offlineDir: string; // offline/ of the pinned benchmark checkout
  judgeDir: string; // working directory holding results/benchmark_data.json
  tool: string;
  model: string;
  baseUrl: string; // the local proxy
  apiKey: string;
  onSpawn?: (kill: () => void) => void;
};

// Same rule as sanitize_model_name() in the pipeline.
export function modelDirName(model: string): string {
  return model.trim().replace(/\//g, '_');
}

// Runs the benchmark's own scripts, unmodified, from the pinned checkout:
// candidate extraction, deduplication, the LLM judge, then the scoring script.
// They read and write ./results relative to the working directory.
export async function runJudge(o: JudgeOptions): Promise<JudgeResult> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MARTIAN_API_KEY: o.apiKey,
    MARTIAN_BASE_URL: o.baseUrl,
    MARTIAN_MODEL: o.model,
    PYTHONPATH: o.offlineDir,
    // Keep the pinned checkout pristine: virtualenv and bytecode live elsewhere
    UV_PROJECT_ENVIRONMENT: path.join(o.offlineDir, '..', '..', 'benchmark-venv'),
    PYTHONDONTWRITEBYTECODE: '1',
    // The scripts open files with the platform default encoding
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };
  const python = (module: string, args: string[]) =>
    runProc('uv', ['run', '--project', o.offlineDir, '--frozen', 'python', '-m', module, ...args], {
      cwd: o.judgeDir,
      env,
      onSpawn: o.onSpawn,
    });

  const modelDir = path.join(o.judgeDir, 'results', modelDirName(o.model));
  const steps: JudgeStep[] = [];
  const plan: [string, string, string[]][] = [
    ['extract', 'code_review_benchmark.step2_extract_comments', ['--tool', o.tool]],
    ['dedup', 'code_review_benchmark.step2_5_dedup_candidates', ['--tool', o.tool]],
    ['judge', 'code_review_benchmark.step3_judge_comments', ['--tool', o.tool]],
  ];
  let ok = true;
  for (const [name, module, args] of plan) {
    const res = await python(module, args);
    steps.push({ name, code: res.code, ms: res.ms, tail: lastLines(res.stdout + res.stderr, 6) });
    if (res.code !== 0) {
      ok = false;
      break;
    }
  }

  const evalFile = path.join(modelDir, 'evaluations.json');
  const evaluations = fs.existsSync(evalFile)
    ? (JSON.parse(fs.readFileSync(evalFile, 'utf-8')) as Evaluations)
    : null;
  let scoreProfiles = '';
  if (ok && evaluations) {
    const res = await python('analysis.score_profiles', [
      '--results-dir',
      'results',
      '--model',
      modelDirName(o.model),
      '--all-profiles',
      '--beta',
      '1',
    ]);
    steps.push({
      name: 'score_profiles',
      code: res.code,
      ms: res.ms,
      tail: lastLines(res.stderr, 3),
    });
    scoreProfiles = res.stdout;
  }
  return { ok: ok && evaluations !== null, steps, modelDir, evaluations, scoreProfiles };
}

import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { ensureDir } from '../formatters/diff.js';
import { runHeadless, runInteractive } from '../runners/execute.js';
import type { ResolvedRunner } from '../runners/types.js';
import { wrapWithPersona, type Persona } from './personas.js';
import { buildJudgePrompt, isValidJudgeOutput, type IterationReview } from './judge.js';
import { success } from '../ux/theme.js';
import { copyToClipboard } from '../ux/clipboard.js';
import { select } from '../ux/prompt.js';
import type { Ora } from 'ora';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

// Keeps a long-running spinner honest by appending elapsed time to its label.
function startTicker(spin: Ora, label: string): () => void {
  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    spin.text = `${label} (${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s)`;
  }, 1000);
  return () => clearInterval(tick);
}

function promptFileInstruction(promptPath: string): string {
  return `Read the file ${promptPath}. It contains code review instructions and a diff. Execute those instructions exactly and output only the numbered issue blocks the instructions specify.`;
}

function discussInstruction(consolidatedPath: string): string {
  return (
    `Read the file ${consolidatedPath}. It contains a multi-reviewer code review of my current changes (findings are deduplicated, each with a Consensus score). ` +
    `The reviewers only saw the diff, not the codebase, so some findings may be false positives. ` +
    `First verify every finding against the actual code. Discard the ones you confirm are false positives without asking me about them — at most, list them in one line each at the end with the reason. ` +
    `Then walk me through only the confirmed findings, starting with the highest severity, and apply fixes where I agree.`
  );
}

function commentInstruction(consolidatedPath: string, runDir: string): string {
  return (
    `Read the file ${consolidatedPath}. It contains a multi-reviewer code review of changes I am reviewing — I may not be the author, so do NOT modify any source files. ` +
    `The reviewers only saw the diff, not the codebase, so some findings may be false positives. ` +
    `First verify every finding against the actual code and silently drop confirmed false positives (one-line mention each at the end, at most). ` +
    `Then turn the confirmed findings into concise, constructive MR/PR review comments — one per finding, with file and line references, ready to paste — and write them to ${runDir}/comments.md. ` +
    `If I ask, help me post them with a CLI like gh or glab.`
  );
}

export type PostReviewAction = 'fix' | 'comment' | 'none';

// Single pass: interactive chat in a TTY, headless (response saved) otherwise.
export async function runSingleReview(
  runner: ResolvedRunner,
  promptPath: string,
  opts: { isTTY: boolean },
): Promise<void> {
  if (opts.isTTY) {
    console.log(chalk.dim(`Launching ${runner.name} with the review prompt...`));
    const res = await runInteractive(runner, promptFileInstruction(promptPath));
    if (!res.ok) throw new Error(res.error);
    return;
  }

  console.warn(
    chalk.yellow(`stdout is not a TTY; running "${runner.name}" headless and saving the response.`),
  );
  const spin = ora(`Running ${runner.name}...`).start();
  const stopTicker = startTicker(spin, `Running ${runner.name}...`);
  const prompt = fs.readFileSync(promptPath, 'utf-8');
  const res = await runHeadless(runner, prompt, { promptFile: promptPath });
  stopTicker();
  if (!res.ok) {
    spin.fail(chalk.red(`${runner.name} failed`));
    throw new Error(res.error);
  }
  const responsePath = promptPath.replace(/\.md$/i, '.response.md');
  fs.writeFileSync(responsePath, res.output, 'utf-8');
  spin.succeed(chalk.green(`Review complete`));
  console.log(success([chalk.green('AI review saved'), chalk.dim(`response: ${responsePath}`)]));
}

export type ConsensusOptions = {
  runner: ResolvedRunner;
  personas: Persona[];
  renderedPrompt: string;
  diff: string;
  outDir: string;
  isTTY: boolean;
  copy?: boolean;
  then?: PostReviewAction; // post-consolidation action; undefined = ask in a TTY
};

// Multi-reviewer consensus: N persona passes, then a judge pass that validates
// every finding against the diff, dedupes, and records consensus.
export async function runConsensusReview(o: ConsensusOptions): Promise<void> {
  const runDir = path.join(o.outDir, `run_${timestamp()}`);
  ensureDir(runDir);
  fs.writeFileSync(path.join(runDir, 'prompt.md'), o.renderedPrompt, 'utf-8');
  console.log(chalk.dim(`Artifacts land in ${runDir} as each pass completes.`));

  const reviews: IterationReview[] = [];
  const failed: { persona: Persona; error: string }[] = [];
  const total = o.personas.length;

  for (let i = 0; i < total; i++) {
    const persona = o.personas[i];
    const base = `iteration_${i + 1}_${persona.slug}`;
    const iterationPrompt = wrapWithPersona(o.renderedPrompt, persona);
    const iterationPromptPath = path.join(runDir, `${base}.prompt.md`);
    fs.writeFileSync(iterationPromptPath, iterationPrompt, 'utf-8');

    const label = `Reviewer ${i + 1}/${total} — ${persona.name}...`;
    const spin = ora(label).start();
    const stopTicker = startTicker(spin, label);
    const res = await runHeadless(o.runner, iterationPrompt, { promptFile: iterationPromptPath });
    stopTicker();
    if (res.ok) {
      fs.writeFileSync(path.join(runDir, `${base}.response.md`), res.output, 'utf-8');
      reviews.push({ persona, output: res.output });
      spin.succeed(chalk.green(`Reviewer ${i + 1}/${total} — ${persona.name} done`));
    } else {
      failed.push({ persona, error: res.error });
      spin.warn(chalk.yellow(`Reviewer ${i + 1}/${total} — ${persona.name} failed: ${res.error}`));
    }
  }

  if (reviews.length < 2) {
    throw new Error(
      `Only ${reviews.length} of ${total} reviewer passes succeeded — need at least 2 to build a consensus. ` +
        `Successful responses (if any) are kept in ${runDir}.`,
    );
  }

  const judgePrompt = buildJudgePrompt(o.diff, reviews);
  const judgePromptPath = path.join(runDir, 'judge.prompt.md');
  fs.writeFileSync(judgePromptPath, judgePrompt, 'utf-8');

  const judgeLabel = `Judge — validating ${reviews.length} reviews against the diff...`;
  const spin = ora(judgeLabel).start();
  const stopJudgeTicker = startTicker(spin, judgeLabel);
  const judgeRes = await runHeadless(o.runner, judgePrompt, { promptFile: judgePromptPath });
  stopJudgeTicker();
  if (!judgeRes.ok || !isValidJudgeOutput(judgeRes.output)) {
    spin.fail(chalk.red('Judge pass failed'));
    const reason = judgeRes.ok ? 'output did not match the expected review schema' : judgeRes.error;
    throw new Error(
      `Judge pass failed (${reason}). All reviewer responses are intact in ${runDir}; ` +
        `you can re-run the judge manually by feeding ${judgePromptPath} to any AI.`,
    );
  }
  spin.succeed(chalk.green('Judge pass complete'));

  const header =
    failed.length > 0
      ? `<!-- Note: ${failed.length} reviewer pass(es) failed (${failed
          .map((f) => f.persona.name)
          .join(', ')}); consensus is out of ${reviews.length} successful reviewers. -->\n\n`
      : '';
  const consolidatedPath = path.join(runDir, 'consolidated.md');
  fs.writeFileSync(consolidatedPath, header + judgeRes.output, 'utf-8');

  let copiedLine = '';
  if (o.copy) {
    const copied = await copyToClipboard(judgeRes.output);
    copiedLine = copied
      ? chalk.dim('copied:  consolidated review → clipboard')
      : chalk.yellow('copied:  clipboard unavailable');
  }

  console.log(
    success(
      [
        chalk.green('Consensus review ready'),
        chalk.dim(`reviewers: ${reviews.length}/${total} succeeded`),
        failed.length > 0
          ? chalk.yellow(`failed:    ${failed.map((f) => f.persona.name).join(', ')}`)
          : '',
        chalk.dim(`artifacts: ${runDir}`),
        chalk.dim(`final:     ${consolidatedPath}`),
        copiedLine,
      ].filter(Boolean),
    ),
  );

  if (!o.isTTY) return;

  // Post-consolidation action: --then wins; otherwise ask. Not every review
  // should end in fixes — reviewing someone else's MR ends in comments.
  let action: PostReviewAction | undefined = o.then;
  if (!action) {
    const picked = await select<PostReviewAction>(
      'Consensus review done — what next?',
      [
        { title: 'Walk through findings and apply fixes', value: 'fix' },
        { title: 'Draft MR/PR review comments (no code changes)', value: 'comment' },
        { title: 'Nothing — just keep the files', value: 'none' },
      ],
      { interactive: true },
    );
    action = picked ?? 'none';
  }
  if (action === 'none') return;

  const instruction =
    action === 'fix'
      ? discussInstruction(consolidatedPath)
      : commentInstruction(consolidatedPath, runDir);
  console.log(
    chalk.dim(
      action === 'fix'
        ? `Launching ${o.runner.name} to walk through the findings...`
        : `Launching ${o.runner.name} to draft review comments...`,
    ),
  );
  const res = await runInteractive(o.runner, instruction);
  if (!res.ok) {
    console.warn(
      chalk.yellow(
        `Could not launch ${o.runner.name} chat (${res.error}). The review is at ${consolidatedPath}.`,
      ),
    );
  }
}

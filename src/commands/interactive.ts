import { Command } from 'commander';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { loadConfig } from '../config/loadConfig.js';
import { assertGitRepo } from '../git/repo.js';
import { listRunnerNames } from '../runners/resolve.js';
import { runCommandInherit } from '../runners/execute.js';
import { personaPool } from '../orchestrator/personas.js';
import { confirm, multiselect, select } from '../ux/prompt.js';
import { header } from '../ux/theme.js';
import type { PostReviewAction } from '../orchestrator/run.js';

export type WizardAnswers = {
  ref: string;
  target: string;
  mode: 'prompt' | 'single' | 'consensus';
  runner?: string;
  personas?: string[] | 'auto';
  then?: PostReviewAction;
  copy?: boolean;
};

// Pure so it can be unit-tested: wizard answers → review argv.
export function buildReviewArgs(a: WizardAnswers): string[] {
  const args = ['review', a.ref, '--target', a.target];
  if (a.mode === 'prompt') {
    if (a.copy) args.push('--copy');
    return args;
  }
  args.push('--run', a.runner ?? 'claude');
  if (a.mode === 'consensus') {
    args.push('--personas', a.personas === 'auto' ? 'auto' : (a.personas ?? []).join(','));
    if (a.then) args.push('--then', a.then);
  }
  return args;
}

function orderBranches(all: string[], first: string | undefined): string[] {
  const rest = all.filter((b) => b !== first).sort();
  return first && all.includes(first) ? [first, ...rest] : rest;
}

export function registerInteractive(program: Command): void {
  program
    .command('interactive')
    .alias('i')
    .description('Guided review: pick branch, target, reviewers, and outcome interactively')
    .action(async (_opts: unknown, cmd: Command) => {
      try {
        assertGitRepo();
        const globalOpts =
          (cmd?.parent as unknown as { opts?: () => { interactive?: boolean } })?.opts?.() ?? {};
        const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
        if (!isTTY || globalOpts.interactive === false) {
          throw new Error(
            'diff2ai interactive needs a terminal. In scripts, call `diff2ai review` with flags instead.',
          );
        }

        const { config } = loadConfig();
        const git = simpleGit();
        const branchInfo = await git.branchLocal();
        const branches = branchInfo.all;
        if (branches.length === 0) {
          throw new Error('No local branches found. Commit something first.');
        }

        console.log(header('diff2ai interactive', 'Enter confirms • Ctrl+C aborts'));

        // 1. Branch to review — current branch first
        const ref = await select<string>(
          'Branch to review',
          orderBranches(branches, branchInfo.current).map((b) => ({
            title: b === branchInfo.current ? `${b} (current)` : b,
            value: b,
          })),
          { interactive: true },
        );
        if (ref === null) return abort();

        // 2. Target — config target (default main) first
        const target = await select<string>(
          'Target branch to diff against',
          orderBranches(
            branches.includes(config.target) ? branches : [config.target, ...branches],
            config.target,
          )
            .filter((b) => b !== ref)
            .map((b) => ({ title: b === config.target ? `${b} (default)` : b, value: b })),
          { interactive: true },
        );
        if (target === null) return abort();

        // 3. Mode
        const mode = await select<'prompt' | 'single' | 'consensus'>(
          'How should the review run?',
          [
            {
              title: 'AI chat — one reviewer, opens a chat with the prompt loaded',
              value: 'single',
            },
            {
              title: 'Consensus — multiple reviewer personas + validating judge',
              value: 'consensus',
            },
            { title: 'Prompt only — write the prompt file, run no AI', value: 'prompt' },
          ],
          { interactive: true },
        );
        if (mode === null) return abort();

        const answers: WizardAnswers = { ref, target, mode };

        if (mode === 'prompt') {
          answers.copy = await confirm('Also copy the prompt to the clipboard?', {
            interactive: true,
            initial: true,
          });
        } else {
          // 4. Runner
          const runners = listRunnerNames(config.runners);
          answers.runner =
            runners.length === 1
              ? runners[0]
              : ((await select<string>(
                  'AI runner',
                  orderBranches(runners, 'claude').map((r) => ({ title: r, value: r })),
                  { interactive: true },
                )) ?? undefined);
          if (!answers.runner) return abort();
        }

        if (mode === 'consensus') {
          // 5. Personas — auto suggests from the diff (approved via the cost
          // confirm), manual opens the multi-select
          const personaMode = await select<'auto' | 'manual'>(
            'Reviewer personas',
            [
              {
                title: 'Auto — AI picks from a summary of the change (heuristics fallback)',
                value: 'auto',
              },
              { title: 'Pick manually', value: 'manual' },
            ],
            { interactive: true },
          );
          if (personaMode === null) return abort();
          if (personaMode === 'auto') {
            answers.personas = 'auto';
          } else {
            const pool = personaPool(config.personas);
            const picked = await multiselect<string>(
              'Reviewer personas (pick at least 2)',
              pool.map((p, idx) => ({
                title: `${p.name} (${p.slug})`,
                value: p.slug,
                selected: idx < 3,
              })),
              { interactive: true, min: 2 },
            );
            if (picked === null || picked.length < 2) return abort();
            answers.personas = picked;
          }

          // 6. Outcome
          const then = await select<PostReviewAction>(
            'After the consolidated review is ready',
            [
              { title: 'Fix — chat verifies findings and applies fixes with you', value: 'fix' },
              {
                title: 'Comment — chat drafts MR/PR review comments, no code changes',
                value: 'comment',
              },
              {
                title: 'None — just keep the files (post later with `diff2ai post`)',
                value: 'none',
              },
            ],
            { interactive: true },
          );
          if (then === null) return abort();
          answers.then = then;
        }

        const args = buildReviewArgs(answers);
        console.log(chalk.dim(`\n> diff2ai ${args.join(' ')}\n`));
        const code = await runCommandInherit(process.execPath, [process.argv[1], ...args]);
        if (code !== 0) process.exitCode = code ?? 1;
      } catch (error: unknown) {
        console.error(chalk.red((error as Error)?.message ?? String(error)));
        process.exitCode = 1;
      }
    });
}

function abort(): void {
  console.log(chalk.gray('Aborted.'));
}

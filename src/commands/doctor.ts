import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { gatherPreflight } from '../ux/preflight.js';
import { resolveRepoRoot } from '../git/repo.js';
import { loadConfig } from '../config/loadConfig.js';
import { listRunnerNames, resolveRunner } from '../runners/resolve.js';
import { findOnPath } from '../runners/execute.js';
import { withErrors } from './shared.js';

function ago(sec: number): string {
  if (sec < 90) return `${sec}s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)}m ago`;
  if (sec < 172_800) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86_400)}d ago`;
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose repository state, config, and installed AI / git-hosting CLIs')
    .action(
      withErrors(async () => {
        const spinner = ora('Checking repository state...').start();
        let root: string;
        let pre: Awaited<ReturnType<typeof gatherPreflight>>;
        try {
          root = await resolveRepoRoot();
          pre = await gatherPreflight(root);
        } catch (e) {
          spinner.fail('Failed to check repository');
          throw e;
        }
        spinner.succeed('Repository status');

        const line = (label: string, value: string) => console.log(chalk.bold(label), value);
        line('Repository: ', root);
        line('Working tree: ', pre.isDirty ? chalk.yellow('dirty') : chalk.green('clean'));
        line('Untracked files: ', pre.hasUntracked ? chalk.yellow('yes') : chalk.green('no'));
        line('Ongoing operation: ', pre.ongoingMerge ? chalk.red('yes') : chalk.green('no'));
        line('Current branch: ', pre.currentBranch ?? chalk.gray('unknown'));
        line(
          'Ahead/Behind: ',
          pre.ahead || pre.behind
            ? chalk.yellow(`${pre.ahead} ahead / ${pre.behind} behind`)
            : chalk.green('up-to-date'),
        );
        line(
          'Last fetch: ',
          pre.lastFetchAgoSec == null ? chalk.gray('never') : chalk.cyan(ago(pre.lastFetchAgoSec)),
        );

        const { config, warnings } = loadConfig(root);
        const hasConfig = fs.existsSync(path.join(root, '.aidiff.json'));
        const configProblem = warnings.find((w) => /failed to parse/i.test(w));
        line(
          'Config: ',
          configProblem
            ? chalk.red('.aidiff.json could not be parsed (defaults in use)')
            : hasConfig
              ? chalk.green(`.aidiff.json (target: ${config.target})`)
              : chalk.gray(`none (defaults; target: ${config.target})`),
        );

        const runners = listRunnerNames(config.runners).map((name) => {
          const command = resolveRunner(name, config.runners).command;
          return { name, found: Boolean(findOnPath(command)) };
        });
        line(
          'AI runners: ',
          runners
            .map((r) => (r.found ? chalk.green(`${r.name} ✓`) : chalk.gray(`${r.name} ✗`)))
            .join('  '),
        );
        const ghCommand = config.github?.command ?? 'gh';
        const glabCommand = config.gitlab?.command ?? 'glab';
        line(
          'Posting CLIs: ',
          [
            findOnPath(ghCommand) ? chalk.green('gh ✓') : chalk.gray('gh ✗'),
            findOnPath(glabCommand) ? chalk.green('glab ✓') : chalk.gray('glab ✗'),
          ].join('  '),
        );

        console.log('\nSuggestions:');
        let suggested = false;
        const suggest = (...parts: string[]) => {
          suggested = true;
          console.log(' -', ...parts);
        };
        if (pre.lastFetchAgoSec == null || pre.lastFetchAgoSec > 3600) {
          suggest('Refresh remote branches before reviewing:', chalk.blue('git fetch --all'));
        }
        if (pre.ahead || pre.behind) {
          suggest(
            'Diverged from upstream. Review with:',
            chalk.blue('git status'),
            'and',
            chalk.blue('git log --oneline --graph --decorate --all'),
          );
        }
        if (pre.isDirty || pre.hasUntracked) {
          suggest('Working tree changes present. Stash or commit before risky operations.');
        }
        if (!runners.some((r) => r.found)) {
          suggest(
            'No AI runner on PATH: install one (e.g. Claude Code) to use',
            chalk.blue('diff2ai review --run <runner>'),
          );
        }
        if (configProblem) suggest('Fix the JSON5 syntax in .aidiff.json.');
        if (!suggested) console.log(chalk.green(' - Nothing to do. Ready to review.'));
      }),
    );
}

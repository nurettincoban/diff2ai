import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { gatherPreflight } from '../ux/preflight.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose repository state and suggest next steps')
    .action(async () => {
      const spinner = ora('Checking repository state...').start();
      try {
        const pre = await gatherPreflight('main');
        spinner.succeed('Repository status');

        console.log(chalk.bold('Working tree: '), pre.isDirty ? chalk.yellow('dirty') : chalk.green('clean'));
        console.log(chalk.bold('Untracked files: '), pre.hasUntracked ? chalk.yellow('yes') : chalk.green('no'));
        console.log(chalk.bold('Ongoing operation: '), pre.ongoingMerge ? chalk.red('yes') : chalk.green('no'));
        console.log(chalk.bold('Current branch: '), pre.currentBranch ?? chalk.gray('unknown'));
        console.log(
          chalk.bold('Ahead/Behind: '),
          pre.ahead || pre.behind ? chalk.yellow(`${pre.ahead} ahead / ${pre.behind} behind`) : chalk.green('up-to-date'),
        );
        console.log(
          chalk.bold('Last fetch: '),
          pre.lastFetchAgoSec == null ? chalk.gray('unknown') : chalk.cyan(`${pre.lastFetchAgoSec}s ago`),
        );

        console.log('\nSuggestions:');
        if (pre.lastFetchAgoSec == null || pre.lastFetchAgoSec > 600) {
          console.log(' - Consider running: ', chalk.blue('git fetch --all'));
        }
        if (pre.ahead || pre.behind) {
          console.log(' - Diverged from upstream. Review with: ', chalk.blue('git status'), ' and ', chalk.blue('git log --oneline --graph --decorate --all'));
        }
        if (pre.isDirty || pre.hasUntracked) {
          console.log(' - Working tree changes present. Stash or commit before risky operations.');
        }
      } catch (e) {
        spinner.fail('Failed to check repository');
        console.error((e as Error).message);
      }
    });
}

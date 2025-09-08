import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../config/loadConfig.js';
import { assertGitRepo } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile } from '../formatters/diff.js';
import { renderTemplate } from '../formatters/markdown.js';
import fs from 'fs';
import path from 'path';
import { chunkDiff } from '../chunker/chunk.js';
import type { ProfileName } from '../chunker/profiles.js';

export function registerReview(program: Command): void {
  program
    .command('review <ref>')
    .description('Review a branch or git ref against target (pure git)')
    .option('--target <branch>', 'Target branch (default from config)')
    .option('--template <name>', 'Template for prompt generation (basic|default)', 'default')
    .option('--profile <name>', 'Chunking profile', 'generic-medium')
    .action(async (ref: string, opts: { target?: string; template: 'basic' | 'default'; profile: ProfileName }) => {
      try {
        assertGitRepo();
        const { config } = loadConfig();

        const targetBranch = opts.target ?? config.target;
        const targetRef = `origin/${targetBranch}`;

        const spin = ora('Generating diff...').start();
        const diff = await generateUnifiedDiff({ targetRef, compareRef: ref });
        if (!diff || diff.trim().length === 0) {
          spin.stop();
          console.log(chalk.gray('No changes detected.'));
          return;
        }
        const diffPath = writeDiffFile('review', diff);
        spin.succeed(chalk.green(`Wrote diff: ${diffPath}`));

        // Auto-generate prompt using selected template
        const md = renderTemplate((opts.template as any) ?? 'default', fs.readFileSync(diffPath, 'utf-8'));
        const out = diffPath.replace(/\.diff$/i, '.md');
        fs.writeFileSync(out, md, 'utf-8');
        console.log(chalk.green(`Wrote prompt: ${out}`));
      } catch (error: unknown) {
        console.error(chalk.red((error as Error)?.message ?? String(error)));
        process.exitCode = 1;
      }
    });
}

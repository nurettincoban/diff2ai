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
import { header, success } from '../ux/theme.js';

export function registerReview(program: Command): void {
  program
    .command('review <ref>')
    .description('Review a branch or git ref against target (pure git)')
    .option('--target <branch>', 'Target branch (default from config)')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .option('--template <name>', 'Template for prompt generation (basic|default)', 'default')
    .option('--profile <name>', 'Chunking profile', 'generic-medium')
    .action(async (
      ref: string,
      opts: { target?: string; template: 'basic' | 'default'; profile: ProfileName; out?: string },
    ) => {
      try {
        assertGitRepo();
        const { config } = loadConfig();

        console.log(header('diff2ai review', `ref: ${ref}  •  target: ${opts.target ?? config.target}`));

        const targetBranch = opts.target ?? config.target;
        const targetRef = `origin/${targetBranch}`;

        const spin = ora('Generating diff...').start();
        const diff = await generateUnifiedDiff({ targetRef, compareRef: ref });
        if (!diff || diff.trim().length === 0) {
          spin.stop();
          console.log(chalk.gray('No changes detected.'));
          return;
        }
        const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
        const diffPath = writeDiffFile('review', diff, outDir);
        spin.succeed(chalk.green(`Wrote diff: ${diffPath}`));

        const md = renderTemplate((opts.template as any) ?? 'default', fs.readFileSync(diffPath, 'utf-8'));
        const out = diffPath.replace(/\.diff$/i, '.md');
        fs.writeFileSync(out, md, 'utf-8');
        console.log(
          success([
            chalk.green('Review prompt ready'),
            chalk.dim(`diff:    ${diffPath}`),
            chalk.dim(`prompt:  ${out}`),
            '',
            'Next:',
            '- Use this prompt with your AI reviewer (e.g., paste into your AI tool).',
            '- Save the AI response wherever you prefer (PR comments or a review.md file).',
          ]),
        );
      } catch (error: unknown) {
        console.error(chalk.red((error as Error)?.message ?? String(error)));
        process.exitCode = 1;
      }
    });
}

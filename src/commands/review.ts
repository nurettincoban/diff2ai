import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../config/loadConfig.js';
import { assertGitRepo } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile, ensureDir } from '../formatters/diff.js';
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
    .option('--copy', 'Copy generated prompt to clipboard')
    .option('--save-diff', 'Also write the raw .diff file')
    .action(async (
      ref: string,
      opts: { target?: string; template: 'basic' | 'default'; profile: ProfileName; out?: string; copy?: boolean; saveDiff?: boolean },
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
        ensureDir(outDir);
        let diffPath: string | undefined;
        if (opts.saveDiff) {
          diffPath = writeDiffFile('review', diff, outDir);
          spin.succeed(chalk.green(`Wrote diff: ${diffPath}`));
        } else {
          spin.succeed(chalk.green('Generated diff in memory'));
        }

        const md = renderTemplate((opts.template as any) ?? 'default', diff);
        let out: string;
        if (diffPath) {
          out = diffPath.replace(/\.diff$/i, '.md');
        } else {
          const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .replace('Z', '');
          out = path.join(outDir, `review_${timestamp}.md`);
        }
        fs.writeFileSync(out, md, 'utf-8');
        if (opts.copy) {
          try {
            const mod: any = await import('clipboardy');
            const clip = mod?.default ?? mod;
            if (clip && typeof clip.write === 'function') {
              await clip.write(md);
            } else {
              throw new Error('clipboardy not available');
            }
          } catch (e) {
            console.warn(chalk.yellow('Warning: Failed to copy prompt to clipboard.'));
          }
        }
        console.log(
          success([
            chalk.green('Review prompt ready'),
            diffPath ? chalk.dim(`diff:    ${diffPath}`) : chalk.dim('diff:    (not saved, use --save-diff)'),
            chalk.dim(`prompt:  ${out}`),
            opts.copy ? chalk.dim('copied:  clipboard') : '',
            '',
            'Next:',
            '- Use this prompt with your AI reviewer (paste into your AI tool).',
          ]),
        );
      } catch (error: unknown) {
        console.error(chalk.red((error as Error)?.message ?? String(error)));
        process.exitCode = 1;
      }
    });
}

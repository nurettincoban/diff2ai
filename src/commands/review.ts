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
// no chunking in this command
import type { ProfileName } from '../chunker/profiles.js';
import { header, success } from '../ux/theme.js';
import { simpleGit } from 'simple-git';
import { gatherPreflight } from '../ux/preflight.js';

export function registerReview(program: Command): void {
  program
    .command('review <ref>')
    .description('Review a branch or git ref against target (pure git)')
    .option('--target <branch>', 'Target branch (default from config)')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .option(
      '--template <nameOrPath>',
      'Template for prompt generation (name or .md path)',
      'default',
    )
    .option(
      '--templates-dir <dir>',
      'Directory for resolving named templates (default: ./templates)',
    )
    .option('--profile <name>', 'Chunking profile', 'generic-medium')
    .option('--copy', 'Copy generated prompt to clipboard')
    .option('--save-diff', 'Also write the raw .diff file')
    .option('--switch', 'Switch to <ref> before running review (repo stays on <ref>)')
    .option('--fetch', 'Fetch origin/<target> and origin/<ref> before running')
    .action(
      async (
        ref: string,
        opts: {
          target?: string;
          template: string;
          templatesDir?: string;
          profile: ProfileName;
          out?: string;
          copy?: boolean;
          saveDiff?: boolean;
          switch?: boolean;
          fetch?: boolean;
        },
        cmd: Command,
      ) => {
        try {
          assertGitRepo();
          const { config } = loadConfig();
          const globalOpts =
            (
              cmd?.parent as unknown as { opts?: () => { interactive?: boolean; yes?: boolean } }
            )?.opts?.() ?? {};
          const _interactive: boolean =
            globalOpts.interactive === false ? false : process.stdout.isTTY;
          const yes: boolean | undefined = globalOpts.yes;

          console.log(
            header('diff2ai review', `ref: ${ref}  •  target: ${opts.target ?? config.target}`),
          );

          const targetBranch = opts.target ?? config.target;
          const targetRef = `origin/${targetBranch}`;

          const git = simpleGit();

          // Optional fetch of target and/or ref regardless of switching
          if (opts.fetch) {
            try {
              await git.fetch('origin', targetBranch);
            } catch {
              // ignore fetch errors for target
            }
            try {
              await git.fetch('origin', ref);
            } catch {
              // ignore fetch errors for ref (may be a commit or local-only branch)
            }
          }

          // Optional: switch to the provided ref (for agent workflows)
          if (opts.switch) {
            const pre = await gatherPreflight(targetBranch);
            if ((pre.isDirty || pre.hasUntracked || pre.ongoingMerge) && !yes) {
              console.error(
                chalk.red(
                  'Refusing to switch branches: working tree is dirty, has untracked files, or a merge is in progress. Re-run with --yes to proceed.',
                ),
              );
              return;
            }

            console.log(
              header(
                'Switching branch',
                chalk.dim(`Switching to ${ref}; repository will remain on this ref after review.`),
              ),
            );

            // Try to switch using git switch, fallback to checkout
            try {
              await git.raw(['switch', ref]);
            } catch (_e1) {
              try {
                await git.checkout([ref]);
              } catch (_e2) {
                console.error(
                  chalk.red(
                    `Failed to switch to ${ref}. If it's a remote branch, try: git fetch origin ${ref}:${ref}`,
                  ),
                );
                return;
              }
            }
          }

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

          const md = renderTemplate(opts.template ?? config.template ?? 'default', diff, {
            cwd: process.cwd(),
            templatesDir: opts.templatesDir ?? config.templatesDir,
          });
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
              const mod = (await import('clipboardy')) as unknown as {
                default?: { write?: (s: string) => Promise<void> };
                write?: (s: string) => Promise<void>;
              };
              const clip = mod?.default ?? mod;
              if (clip && typeof clip.write === 'function') {
                await clip.write(md);
              } else {
                throw new Error('clipboardy not available');
              }
            } catch {
              console.warn(chalk.yellow('Warning: Failed to copy prompt to clipboard.'));
            }
          }
          console.log(
            success([
              chalk.green('Review prompt ready'),
              diffPath
                ? chalk.dim(`diff:    ${diffPath}`)
                : chalk.dim('diff:    (not saved, use --save-diff)'),
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
      },
    );
}

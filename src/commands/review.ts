import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../config/loadConfig.js';
import { loadIgnore } from '../config/ignore.js';
import { assertGitRepo, resolveTargetRef } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile, ensureDir, writeBatchFiles } from '../formatters/diff.js';
import { renderTemplate } from '../formatters/markdown.js';
import fs from 'fs';
import path from 'path';
import { chunkDiff, approxTokens } from '../chunker/chunk.js';
import { PROFILES, resolveProfile } from '../chunker/profiles.js';
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
    .option(
      '--profile <name>',
      'Chunking profile; prompts larger than its token budget are split into batches (default: from .aidiff.json or generic-medium)',
    )
    .option(
      '--copy',
      'Copy generated prompt to clipboard instead of writing a file (combine with --out or --save-diff to also write it)',
    )
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
          profile?: string;
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
          const yes: boolean | undefined = globalOpts.yes;
          const profile = resolveProfile(opts.profile, config.profile);

          console.log(
            header('diff2ai review', `ref: ${ref}  •  target: ${opts.target ?? config.target}`),
          );

          const targetBranch = opts.target ?? config.target;

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

          const targetRef = await resolveTargetRef(targetBranch);
          const spin = ora('Generating diff...').start();
          const diff = await generateUnifiedDiff({
            targetRef,
            compareRef: ref,
            ignore: loadIgnore(),
          });
          if (!diff || diff.trim().length === 0) {
            spin.stop();
            console.log(chalk.gray('No changes detected.'));
            return;
          }
          const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
          let diffPath: string | undefined;
          if (opts.saveDiff) {
            diffPath = writeDiffFile('review', diff, outDir);
            spin.succeed(chalk.green(`Wrote diff: ${diffPath}`));
          } else {
            spin.succeed(chalk.green('Generated diff in memory'));
          }

          const templateSpec = opts.template ?? config.template ?? 'default';
          const renderOpts = {
            cwd: process.cwd(),
            templatesDir: opts.templatesDir ?? config.templatesDir,
          };

          // --copy alone means clipboard-only output; --out or --save-diff opt back into files
          const copyOnly = Boolean(opts.copy) && !opts.out && !opts.saveDiff;

          let promptLabel: string;
          let clipboardContent: string;
          let copyLabel = 'clipboard';
          let writeSinglePrompt: (() => string) | undefined;
          if (approxTokens(diff) > PROFILES[profile].tokenBudget) {
            // Diff exceeds the profile budget: split into template-wrapped batches.
            // Batches are always written — the clipboard can only hold one of them.
            const { chunks, warnings } = chunkDiff(diff, profile, (d) =>
              renderTemplate(templateSpec, d, renderOpts),
            );
            for (const w of warnings) console.warn(chalk.yellow(w));
            const { indexPath } = writeBatchFiles(chunks, outDir);
            promptLabel = `${chunks.length} batch file(s) + ${path.basename(indexPath)} in ${outDir}`;
            clipboardContent = chunks[0].content;
            copyLabel = `clipboard (batch_1.md of ${chunks.length})`;
          } else {
            const md = renderTemplate(templateSpec, diff, renderOpts);
            clipboardContent = md;
            writeSinglePrompt = () => {
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
              ensureDir(outDir);
              fs.writeFileSync(out, md, 'utf-8');
              return out;
            };
            promptLabel = copyOnly
              ? 'clipboard only (use --out to also write a file)'
              : writeSinglePrompt();
          }
          if (opts.copy) {
            try {
              const mod = (await import('clipboardy')) as unknown as {
                default?: { write?: (s: string) => Promise<void> };
                write?: (s: string) => Promise<void>;
              };
              const clip = mod?.default ?? mod;
              if (clip && typeof clip.write === 'function') {
                await clip.write(clipboardContent);
              } else {
                throw new Error('clipboardy not available');
              }
            } catch {
              if (copyOnly && writeSinglePrompt) {
                // Don't lose the prompt: fall back to writing the file
                promptLabel = writeSinglePrompt();
                copyLabel = 'failed — wrote prompt file instead';
                console.warn(
                  chalk.yellow(
                    'Warning: Failed to copy to clipboard; wrote the prompt to a file instead.',
                  ),
                );
              } else {
                console.warn(chalk.yellow('Warning: Failed to copy prompt to clipboard.'));
              }
            }
          }
          console.log(
            success([
              chalk.green('Review prompt ready'),
              diffPath
                ? chalk.dim(`diff:    ${diffPath}`)
                : chalk.dim('diff:    raw .diff not saved (use --save-diff)'),
              chalk.dim(`prompt:  ${promptLabel}`),
              opts.copy ? chalk.dim(`copied:  ${copyLabel}`) : '',
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

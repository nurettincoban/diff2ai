import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import ora from 'ora';
import chalk from 'chalk';
import { loadIgnore } from '../config/ignore.js';
import {
  findProjectRoot,
  gitClient,
  listRemoteBranches,
  resolveRepoRoot,
  resolveTargetRef,
  assertSafeRef,
} from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile, ensureDir, writeBatchFiles } from '../formatters/diff.js';
import { resolveBuiltInTemplatesDir, resolveProjectTemplatesDir } from '../formatters/markdown.js';
import { buildPrompts, renderPrompt } from '../formatters/prompt.js';
import { resolveBudget } from '../chunker/profiles.js';
import { gatherPreflight } from '../ux/preflight.js';
import { select } from '../ux/prompt.js';
import { registerDoctor } from './doctor.js';
import { registerReview } from './review.js';
import { registerPost } from './post.js';
import { registerClean } from './clean.js';
import { registerInteractive } from './interactive.js';
import { registerExport } from './export.js';
import { header, success } from '../ux/theme.js';
import {
  fromCliOr,
  globalFlags,
  loadProjectConfig,
  parseBudgetOption,
  parseNonNegativeInt,
  reportExcluded,
  resolveOutDir,
  resolveTemplateChoice,
  withErrors,
} from './shared.js';

function readDiffFile(diffFile: string): { abs: string; content: string } {
  const abs = path.resolve(process.cwd(), diffFile);
  if (!fs.existsSync(abs)) throw new Error(`Diff file not found: ${abs}`);
  return { abs, content: fs.readFileSync(abs, 'utf-8') };
}

export function registerCommands(program: Command): void {
  registerDoctor(program);
  registerReview(program);
  registerPost(program);
  registerExport(program);
  registerClean(program);
  registerInteractive(program);

  program
    .command('diff')
    .description(
      'Write a .diff of your work vs the target branch (committed + uncommitted changes), or of staged changes',
    )
    .option('--staged', 'Only staged changes')
    .option('--committed', 'Only committed changes (target...HEAD), ignoring the working tree')
    .option('--target <branch>', 'Target branch (default from config)')
    .option(
      '--context <n>',
      'Lines of context around each change (git -U)',
      parseNonNegativeInt('--context'),
    )
    .option('--function-context', 'Include the whole enclosing function around each change')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(
      withErrors(
        async (
          opts: {
            staged?: boolean;
            committed?: boolean;
            target?: string;
            context?: number;
            functionContext?: boolean;
            out?: string;
          },
          cmd: Command,
        ) => {
          if (opts.staged && opts.committed) throw new Error('Use either --staged or --committed.');
          const root = await resolveRepoRoot();
          const { interactive } = globalFlags(cmd);
          const config = loadProjectConfig(root);
          const ignore = loadIgnore(root, config.exclude);

          // Optionally pick the target interactively when none was given
          let selectedTarget = opts.target ?? config.target;
          if (!opts.staged && !opts.target && interactive) {
            const remotes = await listRemoteBranches(root).catch(() => [] as string[]);
            const choices = remotes
              .filter((b) => b.startsWith('origin/'))
              .map((b) => ({ title: b, value: b }));
            if (choices.length > 0) {
              const picked = await select<string>('Select target branch', choices, { interactive });
              if (picked) selectedTarget = picked.replace(/^origin\//, '');
            }
          }

          const mode = opts.staged ? 'staged' : opts.committed ? 'committed' : 'working tree';
          console.log(
            header(
              'diff2ai diff',
              opts.staged ? 'mode: staged' : `target: ${selectedTarget}  •  mode: ${mode}`,
            ),
          );

          const pre = await gatherPreflight(root);
          if (opts.committed && pre.isDirty) {
            console.log(chalk.dim('Uncommitted changes are not included (--committed).'));
          } else if (!opts.staged && pre.hasUntracked) {
            console.log(
              chalk.dim(
                'Untracked files are not included; `git add -N <file>` makes git (and diff2ai) see them.',
              ),
            );
          }

          const targetRef = opts.staged ? undefined : await resolveTargetRef(selectedTarget, root);
          const spin = ora('Generating diff...').start();
          const excluded: string[] = [];
          const diff = await generateUnifiedDiff(
            {
              staged: Boolean(opts.staged),
              worktree: !opts.staged && !opts.committed,
              targetRef,
              compareRef: 'HEAD',
              contextLines: opts.context ?? config.contextLines,
              functionContext: opts.functionContext ?? config.functionContext,
              ignore,
              onExclude: (f) => excluded.push(f),
            },
            root,
          );
          spin.stop();
          reportExcluded(excluded);

          if (!diff || diff.trim().length === 0) {
            console.log(chalk.gray('No changes detected.'));
            return;
          }

          const outDir = resolveOutDir(opts.out, root);
          const filePath = writeDiffFile(opts.staged ? 'staged' : 'diff', diff, outDir);
          console.log(`Wrote diff: ${filePath}`);
          console.log(
            success([
              chalk.green('Diff ready'),
              chalk.dim(`path:   ${filePath}`),
              '',
              'Next:',
              `- Generate prompt: diff2ai prompt ${path.relative(process.cwd(), filePath)}`,
            ]),
          );
        },
      ),
    );

  program
    .command('show <commit>')
    .description('Write the diff of a single commit (SHA, branch, tag, HEAD~1...)')
    .option(
      '--context <n>',
      'Lines of context around each change (git -U)',
      parseNonNegativeInt('--context'),
    )
    .option('--function-context', 'Include the whole enclosing function around each change')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(
      withErrors(
        async (
          commit: string,
          opts: { context?: number; functionContext?: boolean; out?: string },
        ) => {
          const root = await resolveRepoRoot();
          assertSafeRef(commit, 'commit');
          // Name the file by short SHA: refs like feature/x or HEAD~1 are not
          // safe file names.
          const shortSha = (
            await gitClient(root)
              .revparse(['--short', `${commit}^{commit}`])
              .catch(() => '')
          ).trim();
          if (!shortSha) throw new Error(`Unknown commit "${commit}".`);
          console.log(header('diff2ai show', `commit: ${commit} (${shortSha})`));
          const config = loadProjectConfig(root);
          const excluded: string[] = [];
          const diff = await generateUnifiedDiff(
            {
              commitSha: shortSha,
              contextLines: opts.context ?? config.contextLines,
              functionContext: opts.functionContext ?? config.functionContext,
              ignore: loadIgnore(root, config.exclude),
              onExclude: (f) => excluded.push(f),
            },
            root,
          );
          reportExcluded(excluded);
          if (!diff || diff.trim().length === 0) {
            console.log(chalk.gray('No changes detected.'));
            return;
          }
          const outDir = resolveOutDir(opts.out, root);
          const filePath = writeDiffFile(`commit_${shortSha}`, diff, outDir);
          console.log(`Wrote diff: ${filePath}`);
          console.log(
            success([chalk.green('Commit diff ready'), chalk.dim(`path:   ${filePath}`)]),
          );
        },
      ),
    );

  program
    .command('prompt <diffFile>')
    .description('Generate an AI-ready markdown prompt from a .diff file')
    .option(
      '--template <nameOrPath>',
      'Template: name or .md path (default: from config or "default")',
    )
    .option(
      '--templates-dir <dir>',
      'Directory for resolving named templates (default: ./templates)',
    )
    .option('--no-line-numbers', 'Do not prefix diff lines with their new-file line numbers')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(
      withErrors(
        async (
          diffFile: string,
          opts: { template?: string; templatesDir?: string; lineNumbers: boolean; out?: string },
          cmd: Command,
        ) => {
          const { abs, content } = readDiffFile(diffFile);
          const root = await findProjectRoot();
          const config = loadProjectConfig(root);
          const choice = resolveTemplateChoice(opts, config, root);
          console.log(header('diff2ai prompt', `template: ${choice.template}`));
          const md = renderPrompt(content, {
            ...choice,
            root,
            lineNumbers: fromCliOr(
              cmd,
              'lineNumbers',
              opts.lineNumbers,
              config.lineNumbers ?? true,
            ),
          });
          const outDir = resolveOutDir(opts.out, root);
          ensureDir(outDir);
          const outPath = path.join(outDir, path.basename(abs).replace(/\.diff$/i, '') + '.md');
          fs.writeFileSync(outPath, md, 'utf-8');
          console.log(`Wrote prompt: ${outPath}`);
          console.log(success([chalk.green('Prompt ready'), chalk.dim(`path:   ${outPath}`)]));
        },
      ),
    );

  program
    .command('chunk <diffFile>')
    .description('Split a large .diff into template-wrapped batch prompts that fit a token budget')
    .option(
      '--profile <name>',
      'Budget profile: claude-large|generic-large|generic-medium (default: from .aidiff.json or generic-medium)',
    )
    .option(
      '--budget <tokens>',
      'Token budget per batch, e.g. 200000 or 200k (overrides --profile)',
      parseBudgetOption,
    )
    .option(
      '--template <nameOrPath>',
      'Template: name or .md path (default: from config or "default")',
    )
    .option(
      '--templates-dir <dir>',
      'Directory for resolving named templates (default: ./templates)',
    )
    .option('--no-line-numbers', 'Do not prefix diff lines with their new-file line numbers')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(
      withErrors(
        async (
          diffFile: string,
          opts: {
            profile?: string;
            budget?: number;
            template?: string;
            templatesDir?: string;
            lineNumbers: boolean;
            out?: string;
          },
          cmd: Command,
        ) => {
          const { content } = readDiffFile(diffFile);
          const root = await findProjectRoot();
          const config = loadProjectConfig(root);
          const budget = resolveBudget({
            cliBudget: opts.budget,
            cliProfile: opts.profile,
            configBudget: config.budget,
            configProfile: config.profile,
          });
          console.log(header('diff2ai chunk', `budget: ${budget.label} (${budget.budget} tokens)`));
          const built = buildPrompts(
            content,
            {
              ...resolveTemplateChoice(opts, config, root),
              root,
              lineNumbers: fromCliOr(
                cmd,
                'lineNumbers',
                opts.lineNumbers,
                config.lineNumbers ?? true,
              ),
            },
            budget,
          );
          const chunks =
            built.kind === 'single'
              ? [{ filename: 'batch_1.md', content: built.prompt }]
              : built.chunks;
          if (built.kind === 'batches')
            for (const w of built.warnings) console.warn(chalk.yellow(w));
          const outDir = resolveOutDir(opts.out, root);
          const { indexPath } = writeBatchFiles(chunks, outDir);
          console.log(`Wrote ${chunks.length} batch file(s) and ${path.basename(indexPath)}`);
          console.log(
            success([
              chalk.green('Chunking complete'),
              chalk.dim(`batches: ${chunks.length}`),
              chalk.dim(`index:   ${path.basename(indexPath)}`),
            ]),
          );
        },
      ),
    );

  program
    .command('templates')
    .description('List available templates (project and packaged)')
    .action(
      withErrors(async () => {
        const root = await findProjectRoot();
        const config = loadProjectConfig(root);
        const projectDir = resolveProjectTemplatesDir(
          root,
          config.templatesDir ? path.resolve(root, config.templatesDir) : undefined,
        );
        const builtInDir = resolveBuiltInTemplatesDir();
        const list = (dir: string | null) =>
          dir && fs.existsSync(dir)
            ? fs
                .readdirSync(dir)
                .filter((f) => f.endsWith('.md'))
                .map((f) => f.replace(/\.md$/i, ''))
                .sort()
            : [];
        const project = projectDir && projectDir !== builtInDir ? list(projectDir) : [];
        const builtins = list(builtInDir);

        console.log(header('diff2ai templates', 'Available templates'));
        if (project.length) {
          console.log(chalk.green(`Project templates (${projectDir}):`));
          for (const t of project) console.log(`  - ${t}`);
        } else {
          console.log(chalk.dim('Project templates: (none found)'));
        }
        if (builtins.length) {
          console.log(chalk.green('\nPackaged templates:'));
          for (const t of builtins) console.log(`  - ${t}`);
        } else {
          console.log(chalk.dim('\nPackaged templates: (none found)'));
        }
      }),
    );
}

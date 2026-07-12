import { Command } from 'commander';
import { loadConfig } from '../config/loadConfig.js';
import { loadIgnore } from '../config/ignore.js';
import { assertGitRepo, listRemoteBranches, resolveTargetRef } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile, ensureDir, writeBatchFiles } from '../formatters/diff.js';
import { renderTemplate, resolveBuiltInTemplatesDir } from '../formatters/markdown.js';
import fs from 'fs';
import path from 'path';
import { chunkDiff } from '../chunker/chunk.js';
import { resolveProfile } from '../chunker/profiles.js';
import { gatherPreflight } from '../ux/preflight.js';
import { confirm, select } from '../ux/prompt.js';
import { registerDoctor } from './doctor.js';
import ora from 'ora';
import chalk from 'chalk';
import { registerReview } from './review.js';
import { registerPost } from './post.js';
import { header, success } from '../ux/theme.js';

function reportExcluded(excluded: string[]): void {
  if (excluded.length === 0) return;
  console.log(
    chalk.dim(
      `Excluded ${excluded.length} file(s) via exclude patterns (.aidiff.json / .aidiffignore).`,
    ),
  );
}

export function registerCommands(program: Command): void {
  registerDoctor(program);
  registerReview(program);
  registerPost(program);

  program
    .command('diff')
    .description('Generate diff for working tree vs target or staged changes')
    .option('--staged', 'Use staged changes')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(async (opts: { staged?: boolean; out?: string }) => {
      try {
        assertGitRepo();
        const globalOpts = program.opts();
        const interactive: boolean =
          globalOpts.interactive === false ? false : process.stdout.isTTY;
        const yes: boolean | undefined = globalOpts.yes;

        const { config, warnings } = loadConfig();
        const ignore = loadIgnore(process.cwd(), config.exclude);
        for (const w of warnings) console.warn(chalk.yellow(w));

        const pre = await gatherPreflight();
        if (pre.isDirty && !opts.staged) {
          const proceed = await confirm(
            'Working tree is dirty. Continue diff against target anyway?',
            {
              interactive,
              yes,
            },
          );
          if (!proceed) return void console.log(chalk.gray('Aborted.'));
        }

        // Optionally select target branch interactively
        let selectedTarget = config.target;
        if (!opts.staged && interactive) {
          try {
            const remotes = await listRemoteBranches();
            const originBranches = remotes.filter((b) => b.startsWith('origin/'));
            const choices: { title: string; value: string }[] = originBranches.map((b) => ({
              title: b,
              value: b,
            }));
            const picked = await select<string>('Select target branch', choices, {
              interactive,
            });
            if (picked) selectedTarget = (picked as string).replace(/^origin\//, '');
          } catch {
            // ignore selection errors
          }
        }

        console.log(
          header('diff2ai diff', `${opts.staged ? 'mode: staged' : `target: ${selectedTarget}`}`),
        );

        const targetRef = opts.staged ? undefined : await resolveTargetRef(selectedTarget);
        const spin = ora('Generating diff...').start();
        const excluded: string[] = [];
        const diff = await generateUnifiedDiff({
          staged: Boolean(opts.staged),
          targetRef,
          ignore,
          onExclude: (f) => excluded.push(f),
        });

        if (!diff || diff.trim().length === 0) {
          spin.stop();
          reportExcluded(excluded);
          console.log(chalk.gray('No changes detected.'));
          return;
        }

        const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
        const filePath = writeDiffFile(opts.staged ? 'staged' : 'diff', diff, outDir);
        spin.stop();
        reportExcluded(excluded);
        console.log(`Wrote diff: ${filePath}`);
        console.log(
          success([
            chalk.green('Diff ready'),
            chalk.dim(`path:   ${filePath}`),
            '',
            'Next:',
            '- Generate prompt: diff2ai prompt <diff> --template default',
          ]),
        );
      } catch (error: unknown) {
        const message = (error as Error)?.message ?? String(error);
        if (/Not a git repository/i.test(message)) {
          console.error(chalk.red('Error: Missing Git repo. Ensure a .git directory exists.'));
          return;
        }
        if (/ambiguous argument|unknown revision|bad revision/i.test(message)) {
          console.error(chalk.red('Error: Invalid diff target. Available remote branches:'));
          try {
            const branches = await listRemoteBranches();
            for (const b of branches) console.error(chalk.gray(`  ${b}`));
          } catch {
            // ignore follow-up errors
          }
          return;
        }
        console.error(chalk.red(message));
        process.exitCode = 1;
      }
    });

  program
    .command('show <sha>')
    .description('Show commit diff for a specific SHA')
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action(async (sha: string, opts: { out?: string }) => {
      try {
        assertGitRepo();
        console.log(header('diff2ai show', `sha: ${sha}`));
        const { config } = loadConfig();
        const excluded: string[] = [];
        const diff = await generateUnifiedDiff({
          commitSha: sha,
          ignore: loadIgnore(process.cwd(), config.exclude),
          onExclude: (f) => excluded.push(f),
        });
        reportExcluded(excluded);
        if (!diff || diff.trim().length === 0) {
          console.log(chalk.gray('No changes detected.'));
          return;
        }
        const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
        const filePath = writeDiffFile(`commit_${sha}`, diff, outDir);
        console.log(`Wrote diff: ${filePath}`);
        console.log(success([chalk.green('Commit diff ready'), chalk.dim(`path:   ${filePath}`)]));
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('prompt <diffFile>')
    .description('Generate AI-ready markdown prompt from a diff file')
    .option('--template <nameOrPath>', 'Template: name or .md path', 'default')
    .option(
      '--templates-dir <dir>',
      'Directory for resolving named templates (default: ./templates)',
    )
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action((diffFile: string, opts: { template: string; templatesDir?: string; out?: string }) => {
      try {
        const abs = diffFile;
        console.log(header('diff2ai prompt', `template: ${opts.template}`));
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const { config } = loadConfig();
        const md = renderTemplate(opts.template ?? config.template ?? 'default', diffContent, {
          cwd: process.cwd(),
          templatesDir: opts.templatesDir ?? config.templatesDir,
        });
        const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
        ensureDir(outDir);
        const outPath = path.join(outDir, path.basename(abs).replace(/\.diff$/i, '.md'));
        fs.writeFileSync(outPath, md, 'utf-8');
        console.log(`Wrote prompt: ${outPath}`);
        console.log(success([chalk.green('Prompt ready'), chalk.dim(`path:   ${outPath}`)]));
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('chunk <diffFile>')
    .description('Chunk large diff into batches using a token budget profile')
    .option(
      '--profile <name>',
      'Profile: claude-large|generic-large|generic-medium (default: from .aidiff.json or generic-medium)',
    )
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .action((diffFile: string, opts: { profile?: string; out?: string }) => {
      try {
        const abs = diffFile;
        const { config } = loadConfig();
        const profile = resolveProfile(opts.profile, config.profile);
        console.log(header('diff2ai chunk', `profile: ${profile}`));
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const { chunks, warnings } = chunkDiff(diffContent, profile);
        for (const w of warnings) console.warn(chalk.yellow(w));
        const outDir = opts.out ?? path.join(process.cwd(), 'reviews');
        const { indexPath } = writeBatchFiles(chunks, outDir);
        console.log(`Wrote ${chunks.length} batch file(s) and ${path.basename(indexPath)}`);
        console.log(
          success([
            chalk.green('Chunking complete'),
            chalk.dim(`batches: ${chunks.length}`),
            chalk.dim(`index:   ${path.basename(indexPath)}`),
          ]),
        );
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });

  program
    .command('templates')
    .description('List available templates (project and packaged)')
    .action(() => {
      try {
        const cwd = process.cwd();
        const projectDir = path.join(cwd, 'templates');
        const builtInDir = resolveBuiltInTemplatesDir();
        const project: string[] = [];
        const builtins: string[] = [];

        if (fs.existsSync(projectDir) && fs.statSync(projectDir).isDirectory()) {
          for (const f of fs.readdirSync(projectDir)) {
            if (f.endsWith('.md')) project.push(f.replace(/\.md$/i, ''));
          }
        }
        if (builtInDir && fs.existsSync(builtInDir)) {
          for (const f of fs.readdirSync(builtInDir)) {
            if (f.endsWith('.md')) builtins.push(f.replace(/\.md$/i, ''));
          }
        }

        console.log(header('diff2ai templates', 'Available templates'));
        if (project.length) {
          console.log(chalk.green('Project templates:'));
          for (const t of project.sort()) console.log(`  - ${t}`);
        } else {
          console.log(chalk.dim('Project templates: (none found)'));
        }
        if (builtins.length) {
          console.log(chalk.green('\nPackaged templates:'));
          for (const t of builtins.sort()) console.log(`  - ${t}`);
        } else {
          console.log(chalk.dim('\nPackaged templates: (none found)'));
        }
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });
}

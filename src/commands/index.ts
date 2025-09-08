import { Command } from 'commander';
import { loadConfig } from '../config/loadConfig.js';
import { loadIgnore } from '../config/ignore.js';
import { assertGitRepo, listRemoteBranches } from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile } from '../formatters/diff.js';
import { renderTemplate, type TemplateName } from '../formatters/markdown.js';
import fs from 'fs';
import path from 'path';
import { chunkDiff } from '../chunker/chunk.js';
import type { ProfileName } from '../chunker/profiles.js';
import { gatherPreflight } from '../ux/preflight.js';
import { confirm, select } from '../ux/prompt.js';
import { registerDoctor } from './doctor.js';
import ora from 'ora';
import chalk from 'chalk';
import { registerReview } from './review.js';
import { header, success } from '../ux/theme.js';

export function registerCommands(program: Command): void {
  registerDoctor(program);
  registerReview(program);

  program
    .command('diff')
    .description('Generate diff for working tree vs target or staged changes')
    .option('--staged', 'Use staged changes')
    .action(async (opts: { staged?: boolean }) => {
      try {
        assertGitRepo();
        const globalOpts = program.opts();
        const interactive: boolean = globalOpts.interactive === false ? false : process.stdout.isTTY;
        const yes: boolean | undefined = globalOpts.yes;

        const { config, warnings } = loadConfig();
        const ignore = loadIgnore();
        for (const w of warnings) console.warn(chalk.yellow(w));

        const pre = await gatherPreflight(config.target);
        if (pre.isDirty && !opts.staged) {
          const proceed = await confirm('Working tree is dirty. Continue diff against target anyway?', {
            interactive,
            yes,
          });
          if (!proceed) return void console.log(chalk.gray('Aborted.'));
        }

        // Optionally select target branch interactively
        let selectedTarget = config.target;
        if (!opts.staged && interactive) {
          try {
            const remotes = await listRemoteBranches();
            const originBranches = remotes.filter((b) => b.startsWith('origin/'));
            const choices = originBranches.map((b) => ({ title: b, value: b }));
            const picked = await select('Select target branch', choices as any, { interactive, yes });
            if (picked) selectedTarget = (picked as string).replace(/^origin\//, '');
          } catch {
            // ignore selection errors
          }
        }

        console.log(header('diff2ai diff', `${opts.staged ? 'mode: staged' : `target: ${selectedTarget}`}`));

        const targetRef = `origin/${selectedTarget}`;
        const spin = ora('Generating diff...').start();
        const diff = await generateUnifiedDiff({
          staged: Boolean(opts.staged),
          targetRef,
          ignore,
        });

        if (!diff || diff.trim().length === 0) {
          spin.stop();
          console.log(chalk.gray('No changes detected.'));
          return;
        }

        const filePath = writeDiffFile(opts.staged ? 'staged' : 'diff', diff);
        spin.stop();
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
    .action(async (sha: string) => {
      try {
        assertGitRepo();
        console.log(header('diff2ai show', `sha: ${sha}`));
        const diff = await generateUnifiedDiff({ commitSha: sha });
        if (!diff || diff.trim().length === 0) {
          console.log(chalk.gray('No changes detected.'));
          return;
        }
        const filePath = writeDiffFile(`commit_${sha}`, diff);
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
    .option('--template <name>', 'Template: basic|default', 'default')
    .action((diffFile: string, opts: { template: TemplateName }) => {
      try {
        const abs = diffFile;
        console.log(header('diff2ai prompt', `template: ${opts.template}`));
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const md = renderTemplate(opts.template ?? 'default', diffContent);
        const out = abs.replace(/\.diff$/i, '.md');
        fs.writeFileSync(out, md, 'utf-8');
        console.log(`Wrote prompt: ${out}`);
        console.log(success([chalk.green('Prompt ready'), chalk.dim(`path:   ${out}`)]));
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
      'Profile: claude-large|generic-large|generic-medium',
      'generic-medium',
    )
    .action((diffFile: string, opts: { profile: ProfileName }) => {
      try {
        const abs = diffFile;
        console.log(header('diff2ai chunk', `profile: ${opts.profile}`));
        if (!fs.existsSync(abs)) {
          console.error(`Diff file not found: ${abs}`);
          process.exitCode = 1;
          return;
        }
        const diffContent = fs.readFileSync(abs, 'utf-8');
        const { chunks } = chunkDiff(diffContent, opts.profile ?? 'generic-medium');
        const indexLines: string[] = [
          '# Review Batches',
          '',
          'Process each batch with your AI reviewer using the same default template.',
          'Then merge all issue blocks into a single review.md without duplication.',
          '',
        ];
        for (const c of chunks) {
          const out = path.join(process.cwd(), c.filename);
          fs.writeFileSync(out, c.content, 'utf-8');
          indexLines.push(`- ${c.filename}`);
        }
        fs.writeFileSync(path.join(process.cwd(), 'review_index.md'), indexLines.join('\n') + '\n', 'utf-8');
        console.log(`Wrote ${chunks.length} batch file(s) and review_index.md`);
        console.log(
          success([
            chalk.green('Chunking complete'),
            chalk.dim(`batches: ${chunks.length}`),
            chalk.dim('index:   review_index.md'),
          ]),
        );
      } catch (error: unknown) {
        console.error((error as Error)?.message ?? String(error));
        process.exitCode = 1;
      }
    });
}

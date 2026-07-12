import { Command, InvalidArgumentError } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { confirm } from '../ux/prompt.js';
import { header, success } from '../ux/theme.js';

// Only files diff2ai itself generates are ever deleted; anything else in the
// output directory (user notes, saved responses with custom names) is left alone.
const ARTIFACT_FILE_PATTERNS = [
  /^(review|diff|staged|commit)_.*\.(md|diff)$/, // timestamped prompts and diffs
  /^batch_\d+\.md$/,
  /^review_index\.md$/,
  /\.response\.md$/, // headless --run outputs
];

const RUN_DIR_PATTERN = /^run_/;

function isArtifactFile(name: string): boolean {
  return ARTIFACT_FILE_PATTERNS.some((re) => re.test(name));
}

function parseKeep(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new InvalidArgumentError('--keep must be an integer >= 0.');
  }
  return n;
}

export function registerClean(program: Command): void {
  program
    .command('clean')
    .description('Delete diff2ai-generated review artifacts (prompts, diffs, run_* dirs)')
    .option('--out <dir>', 'Output directory to clean (default: reviews/)')
    .option('--keep <n>', 'Keep the newest N run_* directories and loose artifacts', parseKeep, 0)
    .option('--dry-run', 'List what would be deleted, without deleting')
    .action(async (opts: { out?: string; keep: number; dryRun?: boolean }, cmd: Command) => {
      try {
        const globalOpts =
          (
            cmd?.parent as unknown as { opts?: () => { interactive?: boolean; yes?: boolean } }
          )?.opts?.() ?? {};
        const yes: boolean | undefined = globalOpts.yes;
        const interactiveMode =
          globalOpts.interactive === false
            ? false
            : Boolean(process.stdout.isTTY && process.stdin.isTTY);

        const outDir = path.resolve(process.cwd(), opts.out ?? 'reviews');
        console.log(
          header('diff2ai clean', `dir: ${outDir}${opts.keep ? `  •  keep: ${opts.keep}` : ''}`),
        );

        if (!fs.existsSync(outDir)) {
          console.log(chalk.gray('Nothing to clean.'));
          return;
        }

        const entries = fs.readdirSync(outDir, { withFileTypes: true });
        const mtime = (name: string) => fs.statSync(path.join(outDir, name)).mtimeMs;

        const runDirs = entries
          .filter((e) => e.isDirectory() && RUN_DIR_PATTERN.test(e.name))
          .map((e) => e.name)
          .sort((a, b) => mtime(b) - mtime(a));
        const looseFiles = entries
          .filter((e) => e.isFile() && isArtifactFile(e.name))
          .map((e) => e.name)
          .sort((a, b) => mtime(b) - mtime(a));

        const doomedDirs = runDirs.slice(opts.keep);
        const doomedFiles = looseFiles.slice(opts.keep);
        const doomed = [...doomedDirs.map((d) => `${d}/`), ...doomedFiles];

        if (doomed.length === 0) {
          console.log(chalk.gray('Nothing to clean.'));
          return;
        }

        console.log(chalk.dim(`${doomed.length} artifact(s) in ${outDir}:`));
        for (const name of doomed) console.log(chalk.dim(`  - ${name}`));

        if (opts.dryRun) {
          console.log(chalk.gray('\n--dry-run: nothing was deleted.'));
          return;
        }

        const proceed = await confirm(`Delete ${doomed.length} artifact(s)?`, {
          interactive: interactiveMode,
          yes,
        });
        if (interactiveMode && !proceed) {
          console.log(chalk.gray('Aborted — nothing was deleted.'));
          return;
        }
        if (!interactiveMode && !yes) {
          throw new Error(
            'Deleting requires confirmation: re-run with --yes in non-interactive mode, or use --dry-run to preview.',
          );
        }

        for (const dir of doomedDirs) {
          fs.rmSync(path.join(outDir, dir), { recursive: true, force: true });
        }
        for (const file of doomedFiles) {
          fs.rmSync(path.join(outDir, file), { force: true });
        }

        console.log(
          success(
            [
              chalk.green('Cleaned'),
              chalk.dim(`deleted: ${doomedDirs.length} run dir(s), ${doomedFiles.length} file(s)`),
              opts.keep > 0 ? chalk.dim(`kept:    newest ${opts.keep}`) : '',
            ].filter(Boolean),
          ),
        );
      } catch (error: unknown) {
        console.error(chalk.red((error as Error)?.message ?? String(error)));
        process.exitCode = 1;
      }
    });
}

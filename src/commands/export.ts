import { Command, InvalidArgumentError } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { parseSeverity, type Severity } from '../formatters/findings.js';
import { toJson, toSarif } from '../formatters/export.js';
import { gateFindings, loadFindings, resolveReviewFile } from '../formatters/reviewFile.js';
import { findProjectRoot } from '../git/repo.js';
import { resolveOutDir, withErrors } from './shared.js';
import { packageVersion } from '../version.js';

export function parseSeverityOption(value: string): Severity {
  try {
    return parseSeverity(value);
  } catch (e) {
    throw new InvalidArgumentError((e as Error).message);
  }
}

type Format = 'json' | 'sarif';

function parseFormat(value: string): Format {
  if (value === 'json' || value === 'sarif') return value;
  throw new InvalidArgumentError('--format must be json or sarif.');
}

// Prints which findings tripped the gate and sets a failing exit code.
export function applyGate(markdown: string, threshold: Severity | undefined): void {
  if (!threshold) return;
  const failing = gateFindings(markdown, threshold);
  if (failing.length === 0) {
    console.error(
      chalk.green(`Severity gate passed: no verified findings at or above ${threshold}.`),
    );
    return;
  }
  console.error(
    chalk.red(`Severity gate failed: ${failing.length} finding(s) at or above ${threshold}:`),
  );
  for (const f of failing) console.error(chalk.red(`  - [${f.severity}] ${f.title}`));
  process.exitCode = 1;
}

export function registerExport(program: Command): void {
  program
    .command('export <reviewFile>')
    .description(
      "Convert an AI review (or 'latest') into JSON or SARIF, optionally failing on a severity threshold",
    )
    .option('--format <format>', 'json | sarif', parseFormat, 'json')
    .option('--out <file>', 'Write to a file instead of stdout')
    .option(
      '--min-severity <severity>',
      'Only export findings at or above this severity',
      parseSeverityOption,
    )
    .option('--include-unverified', 'Also export findings that failed the local diff verification')
    .option(
      '--fail-on <severity>',
      'Exit with code 1 when a verified finding is at or above this severity (CI gate)',
      parseSeverityOption,
    )
    .action(
      withErrors(
        async (
          reviewFile: string,
          opts: {
            format: Format;
            out?: string;
            minSeverity?: Severity;
            includeUnverified?: boolean;
            failOn?: Severity;
          },
        ) => {
          const root = await findProjectRoot();
          const file = resolveReviewFile(reviewFile, resolveOutDir(undefined, root));
          const markdown = fs.readFileSync(file, 'utf-8');
          const { findings } = loadFindings(markdown, opts);
          const meta = { version: packageVersion(), source: path.relative(root, file) };
          const doc = opts.format === 'sarif' ? toSarif(findings, meta) : toJson(findings, meta);
          if (opts.out) {
            const outPath = path.resolve(process.cwd(), opts.out);
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, doc + '\n', 'utf-8');
            // stdout stays clean for piping; status goes to stderr
            console.error(chalk.dim(`Wrote ${findings.length} finding(s) to ${outPath}`));
          } else {
            process.stdout.write(doc + '\n');
          }
          applyGate(markdown, opts.failOn);
        },
      ),
    );
}

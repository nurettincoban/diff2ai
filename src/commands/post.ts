import { Command, InvalidArgumentError } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { type Severity } from '../formatters/findings.js';
import { loadFindings, resolveReviewFile } from '../formatters/reviewFile.js';
import { formatMrComment, postMrNote } from '../integrations/gitlab.js';
import { formatSummaryComment } from '../integrations/format.js';
import { currentPrNumber, postPrReview } from '../integrations/github.js';
import { findProjectRoot, gitClient } from '../git/repo.js';
import { confirm } from '../ux/prompt.js';
import { header, success } from '../ux/theme.js';
import { parseSeverityOption } from './export.js';
import {
  globalFlags,
  loadProjectConfig,
  parsePositiveInt,
  resolveOutDir,
  withErrors,
} from './shared.js';

type Platform = 'github' | 'gitlab';

function parsePlatform(value: string): Platform {
  if (value === 'github' || value === 'gitlab') return value;
  throw new InvalidArgumentError('--platform must be github or gitlab.');
}

// origin's host decides, then explicit --pr/--mr, then configured CLIs.
// GitLab stays the fallback for backward compatibility.
async function detectPlatform(
  root: string,
  opts: { pr?: number; mr?: string },
  config: { github?: unknown; gitlab?: unknown },
): Promise<Platform> {
  if (opts.pr !== undefined) return 'github';
  if (opts.mr !== undefined) return 'gitlab';
  const url =
    (await gitClient(root)
      .remote(['get-url', 'origin'])
      .catch(() => '')) || '';
  if (/github/i.test(url)) return 'github';
  if (/gitlab/i.test(url)) return 'gitlab';
  if (config.github && !config.gitlab) return 'github';
  return 'gitlab';
}

export function registerPost(program: Command): void {
  program
    .command('post <reviewFile>')
    .description(
      "Post review findings ('latest' or a file) to a GitHub PR (inline review comments via gh) or a GitLab MR (via glab)",
    )
    .option(
      '--platform <platform>',
      'github | gitlab (default: detected from the origin remote)',
      parsePlatform,
    )
    .option(
      '--pr <number>',
      'GitHub PR number (default: PR of the current branch)',
      parsePositiveInt('--pr'),
    )
    .option('--mr <iid>', 'GitLab MR IID or branch (default: MR for the current branch)')
    .option('--no-inline', 'GitHub: post one PR comment instead of a review with inline comments')
    .option(
      '--min-severity <severity>',
      'Only post findings at or above this severity (CRITICAL|HIGH|MEDIUM|LOW|INFO)',
      parseSeverityOption,
    )
    .option('--dry-run', 'Print what would be posted, without posting')
    .option(
      '--include-unverified',
      'Also post findings that failed the local diff verification (skipped by default)',
    )
    .action(
      withErrors(
        async (
          reviewFile: string,
          opts: {
            platform?: Platform;
            pr?: number;
            mr?: string;
            inline: boolean;
            minSeverity?: Severity;
            dryRun?: boolean;
            includeUnverified?: boolean;
          },
          cmd: Command,
        ) => {
          const { yes, interactive } = globalFlags(cmd);
          const root = await findProjectRoot();
          const config = loadProjectConfig(root);
          const file = resolveReviewFile(reviewFile, resolveOutDir(undefined, root));
          const source = path.relative(process.cwd(), file) || path.basename(file);
          const markdown = fs.readFileSync(file, 'utf-8');
          const platform = opts.platform ?? (await detectPlatform(root, opts, config));
          const label = platform === 'github' ? 'PR' : 'MR';
          const targetLabel =
            platform === 'github'
              ? opts.pr
                ? `PR #${opts.pr}`
                : "the current branch's PR"
              : opts.mr
                ? `MR ${opts.mr}`
                : "the current branch's MR";

          console.log(header('diff2ai post', `source: ${source}  •  ${platform}: ${targetLabel}`));

          const loaded = loadFindings(markdown, opts);
          if (loaded.noIssues) {
            console.log(chalk.gray('The review reports no issues — nothing to post.'));
            return;
          }
          if (loaded.skippedUnverified > 0) {
            console.log(
              chalk.dim(
                `Skipped ${loaded.skippedUnverified} unverified finding(s) (failed the local diff check). Use --include-unverified to post them.`,
              ),
            );
          }
          if (loaded.filteredBelow > 0) {
            console.log(
              chalk.dim(`Filtered ${loaded.filteredBelow} finding(s) below ${opts.minSeverity}.`),
            );
          }
          const findings = loaded.findings;
          if (findings.length === 0) {
            if (loaded.skippedUnverified + loaded.filteredBelow === 0) {
              throw new Error(
                `No findings parsed from ${source}. Expected diff2ai issue blocks ("## 1) Severity: ... | Type: ...").`,
              );
            }
            console.log(
              chalk.gray(
                loaded.filteredBelow > 0
                  ? `No findings at or above ${opts.minSeverity} — nothing to post.`
                  : 'All findings are unverified — nothing to post.',
              ),
            );
            return;
          }

          if (opts.dryRun) {
            console.log(chalk.dim('--dry-run: the following comment would be posted:\n'));
            console.log(
              platform === 'github'
                ? formatSummaryComment(findings, { source })
                : formatMrComment(findings, { source }),
            );
            if (platform === 'github' && opts.inline) {
              console.log(
                chalk.dim(
                  '\n(On GitHub, findings on changed lines are posted as inline review comments; the rest go in the review body.)',
                ),
              );
            }
            return;
          }

          console.log(chalk.dim(`About to post ${findings.length} finding(s) to ${targetLabel}.`));
          const proceed = await confirm(`Post to ${platform === 'github' ? 'GitHub' : 'GitLab'}?`, {
            interactive,
            yes,
            initial: true,
          });
          if (interactive && !proceed) {
            console.log(chalk.gray('Aborted — nothing was posted. Use --dry-run to preview.'));
            return;
          }
          if (!interactive && !yes) {
            throw new Error(
              `Posting to ${platform === 'github' ? 'GitHub' : 'GitLab'} requires confirmation: re-run with --yes in non-interactive mode, or use --dry-run to preview.`,
            );
          }

          if (platform === 'gitlab') {
            const res = await postMrNote(formatMrComment(findings, { source }), {
              mr: opts.mr,
              gitlab: config.gitlab,
            });
            if (!res.ok) throw new Error(res.error);
            console.log(
              success(
                [
                  chalk.green('Comment posted'),
                  chalk.dim(`findings: ${findings.length}`),
                  res.output ? chalk.dim(res.output) : '',
                ].filter(Boolean),
              ),
            );
            return;
          }

          const pr = opts.pr ?? (await currentPrNumber(config.github));
          const res = await postPrReview(findings, pr, {
            cfg: config.github,
            source,
            inline: opts.inline,
          });
          if (res.fellBack) {
            console.warn(
              chalk.yellow(`Could not create a review with inline comments (${res.fellBack}).`),
            );
            console.warn(chalk.yellow('Posted all findings as a single PR comment instead.'));
          }
          console.log(
            success(
              [
                chalk.green(
                  res.mode === 'review'
                    ? `Review posted on ${label} #${pr}`
                    : `Comment posted on ${label} #${pr}`,
                ),
                chalk.dim(`findings: ${findings.length}`),
                res.mode === 'review' ? chalk.dim(`inline:   ${res.inline}`) : '',
                res.output ? chalk.dim(res.output) : '',
              ].filter(Boolean),
            ),
          );
        },
      ),
    );
}

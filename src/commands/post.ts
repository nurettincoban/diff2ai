import { Command, InvalidArgumentError } from 'commander';
import fs from 'node:fs';
import chalk from 'chalk';
import { loadConfig } from '../config/loadConfig.js';
import {
  parseFindings,
  parseSeverity,
  severityRank,
  type Severity,
} from '../formatters/findings.js';
import { formatMrComment, postMrNote } from '../integrations/gitlab.js';
import { NO_ISSUES_SENTINEL } from '../orchestrator/judge.js';
import { confirm } from '../ux/prompt.js';
import { header, success } from '../ux/theme.js';

function parseMinSeverity(value: string): Severity {
  try {
    return parseSeverity(value);
  } catch (e) {
    throw new InvalidArgumentError((e as Error).message);
  }
}

export function registerPost(program: Command): void {
  program
    .command('post <reviewFile>')
    .description('Post review findings to a GitLab MR as a comment via your authenticated glab CLI')
    .option('--mr <iid>', 'Target MR IID or branch (default: MR for the current branch)')
    .option(
      '--min-severity <severity>',
      'Only post findings at or above this severity (CRITICAL|HIGH|MEDIUM|LOW|INFO)',
      parseMinSeverity,
    )
    .option('--dry-run', 'Print the comment that would be posted, without posting')
    .action(
      async (
        reviewFile: string,
        opts: { mr?: string; minSeverity?: Severity; dryRun?: boolean },
        cmd: Command,
      ) => {
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

          if (!fs.existsSync(reviewFile)) {
            throw new Error(`Review file not found: ${reviewFile}`);
          }
          const markdown = fs.readFileSync(reviewFile, 'utf-8');

          console.log(
            header(
              'diff2ai post',
              `source: ${reviewFile}  •  target: ${opts.mr ?? 'current branch MR'}`,
            ),
          );

          if (markdown.includes(NO_ISSUES_SENTINEL)) {
            console.log(chalk.gray('The review reports no validated issues — nothing to post.'));
            return;
          }
          let findings = parseFindings(markdown);
          if (findings.length === 0) {
            throw new Error(
              `No findings parsed from ${reviewFile}. Expected diff2ai issue blocks ("## 1) Severity: ... | Type: ...").`,
            );
          }
          if (opts.minSeverity) {
            const cutoff = severityRank(opts.minSeverity);
            const before = findings.length;
            findings = findings.filter((f) => severityRank(f.severity) <= cutoff);
            if (findings.length < before) {
              console.log(
                chalk.dim(
                  `Filtered ${before - findings.length} finding(s) below ${opts.minSeverity}.`,
                ),
              );
            }
            if (findings.length === 0) {
              console.log(
                chalk.gray(`No findings at or above ${opts.minSeverity} — nothing to post.`),
              );
              return;
            }
          }

          const body = formatMrComment(findings, { source: reviewFile });

          if (opts.dryRun) {
            console.log(chalk.dim('--dry-run: the following comment would be posted:\n'));
            console.log(body);
            return;
          }

          console.log(
            chalk.dim(
              `About to post 1 comment with ${findings.length} finding(s) to ${opts.mr ? `MR ${opts.mr}` : "the current branch's MR"}.`,
            ),
          );
          const proceed = await confirm('Post to GitLab?', {
            interactive: interactiveMode,
            yes,
            initial: true,
          });
          if (interactiveMode && !proceed) {
            console.log(chalk.gray('Aborted — nothing was posted. Use --dry-run to preview.'));
            return;
          }
          if (!interactiveMode && !yes) {
            throw new Error(
              'Posting to GitLab requires confirmation: re-run with --yes in non-interactive mode, or use --dry-run to preview.',
            );
          }

          const res = await postMrNote(body, { mr: opts.mr, gitlab: config().gitlab });
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
        } catch (error: unknown) {
          console.error(chalk.red((error as Error)?.message ?? String(error)));
          process.exitCode = 1;
        }
      },
    );
}

function config() {
  return loadConfig().config;
}

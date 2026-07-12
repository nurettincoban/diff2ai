import { Command, InvalidArgumentError } from 'commander';
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
import { resolveRunner } from '../runners/resolve.js';
import type { ResolvedRunner } from '../runners/types.js';
import { personasBySlugs, personaPool, type Persona } from '../orchestrator/personas.js';
import { suggestPersonas, topNPersonaSlugs } from '../orchestrator/signals.js';
import { aiSuggestPersonas } from '../orchestrator/aiSelect.js';
import { runSingleReview, runConsensusReview, type PostReviewAction } from '../orchestrator/run.js';
import { estimateConsensusTokens, formatTokens } from '../orchestrator/estimate.js';
import { approxTokens as approxPromptTokens } from '../chunker/chunk.js';
import { copyToClipboard } from '../ux/clipboard.js';
import { confirm, multiselect } from '../ux/prompt.js';

function parseIterations(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 2) {
    throw new InvalidArgumentError('--iterations must be an integer >= 2.');
  }
  return n;
}

function parseThen(value: string): PostReviewAction {
  if (value === 'fix' || value === 'comment' || value === 'none') return value;
  throw new InvalidArgumentError('--then must be one of: fix, comment, none.');
}

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
    .option(
      '--run <runner>',
      'Run the review with an AI runner (e.g. claude). Opens an interactive chat in a TTY; runs headless otherwise',
    )
    .option(
      '--iterations <n>',
      'Run N reviewer passes with different personas, then a judge pass that validates and consolidates the findings (requires --run)',
      parseIterations,
    )
    .option(
      '--personas <slugs>',
      "Reviewer personas for the consensus run: comma-separated slugs (e.g. correctness,security) or 'auto' to pick from diff signals; overrides the picker and --iterations count",
    )
    .option(
      '--then <action>',
      "After a consensus run: 'fix' (chat to apply fixes), 'comment' (chat to draft MR/PR comments, no code changes), 'none'. Default: ask in a TTY",
      parseThen,
    )
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
          run?: string;
          iterations?: number;
          personas?: string;
          then?: PostReviewAction;
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
          const interactiveMode =
            globalOpts.interactive === false
              ? false
              : Boolean(process.stdout.isTTY && process.stdin.isTTY);

          // Fail fast on runner/persona problems before any git side effects.
          // Persona selection that depends on the diff (auto-suggestions,
          // interactive picker) happens later, once the diff exists.
          let runner: ResolvedRunner | undefined;
          let personas: Persona[] | undefined;
          if ((opts.iterations || opts.personas) && !opts.run) {
            throw new Error(
              '--iterations/--personas require --run <runner> (the reviewer passes execute headlessly). Example: --run claude --iterations 5',
            );
          }
          const consensusRequested = Boolean(opts.run && (opts.iterations || opts.personas));
          if (opts.run) {
            runner = resolveRunner(opts.run, config.runners);
            if (opts.personas && opts.personas !== 'auto') {
              personas = personasBySlugs(opts.personas.split(','), config.personas);
              if (opts.iterations && opts.iterations !== personas.length) {
                console.log(
                  chalk.dim(
                    `Note: --personas selects ${personas.length} reviewer(s); ignoring --iterations ${opts.iterations}.`,
                  ),
                );
              }
              if (personas.length < 2) {
                throw new Error(
                  `A consensus run needs at least 2 reviewer personas (got ${personas.length}).`,
                );
              }
            }
          }
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
            const pre = await gatherPreflight();
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
          const excluded: string[] = [];
          const diff = await generateUnifiedDiff({
            targetRef,
            compareRef: ref,
            ignore: loadIgnore(process.cwd(), config.exclude),
            onExclude: (f) => excluded.push(f),
          });
          if (!diff || diff.trim().length === 0) {
            spin.stop();
            if (excluded.length > 0) {
              console.log(
                chalk.dim(
                  `Excluded ${excluded.length} file(s) via exclude patterns (.aidiff.json / .aidiffignore).`,
                ),
              );
            }
            console.log(chalk.gray('No changes detected.'));
            return;
          }
          if (excluded.length > 0) {
            spin.info(
              chalk.dim(
                `Excluded ${excluded.length} file(s) via exclude patterns (.aidiff.json / .aidiffignore).`,
              ),
            );
            spin.start('Generating diff...');
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

          const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);

          let promptLabel: string;
          let clipboardContent: string;
          let copyLabel = 'clipboard';
          let writeSinglePrompt: (() => string) | undefined;
          let singlePromptPath: string | undefined;
          if (approxTokens(diff) > PROFILES[profile].tokenBudget) {
            if (runner) {
              throw new Error(
                `Diff (~${approxTokens(diff)} tokens) exceeds the "${profile}" profile budget (${PROFILES[profile].tokenBudget}). ` +
                  '--run needs a single prompt; retry with --profile claude-large or drop --run to get batch files.',
              );
            }
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

            // Diff-dependent persona selection: --personas auto asks the AI
            // with a tiny change summary (heuristics as fallback); the picker
            // preselects free heuristic suggestions. The user always approves
            // the run (picker and/or the cost confirm below).
            if (runner && consensusRequested && !personas) {
              const suggestions = suggestPersonas(diff);
              const pool = personaPool(config.personas);
              const reasonOf = new Map(suggestions.map((s) => [s.slug, s.reason]));
              let active = suggestions;
              let selectionLabel = 'from diff signals';

              if (opts.personas === 'auto') {
                const spin = ora('Selecting reviewers (one small AI call)...').start();
                const ai = await aiSuggestPersonas(runner, diff, pool);
                if (ai) {
                  active = ai;
                  selectionLabel = 'AI-selected';
                  spin.succeed(chalk.green('Reviewers selected by AI'));
                } else {
                  spin.warn(chalk.yellow('AI selection unavailable — using local heuristics'));
                }
                personas = personasBySlugs(
                  active.map((s) => s.slug),
                  config.personas,
                );
              } else {
                const n = opts.iterations as number;
                if (n > pool.length) {
                  throw new Error(
                    `--iterations ${n} exceeds the available reviewer personas (${pool.length}). Add more under "personas" in .aidiff.json.`,
                  );
                }
                const topN = topNPersonaSlugs(
                  suggestions,
                  n,
                  pool.map((p) => p.slug),
                );
                if (interactiveMode) {
                  const picked = await multiselect<string>(
                    'Reviewer personas (suggested ones preselected)',
                    pool.map((p) => ({
                      title: reasonOf.has(p.slug)
                        ? `${p.name} (${p.slug}) — suggested: ${reasonOf.get(p.slug)}`
                        : `${p.name} (${p.slug})`,
                      value: p.slug,
                      selected: topN.includes(p.slug),
                    })),
                    { interactive: true, min: 2 },
                  );
                  personas = personasBySlugs(picked ?? topN, config.personas);
                } else {
                  personas = personasBySlugs(topN, config.personas);
                }
              }
              if (personas.length < 2) {
                throw new Error(
                  `A consensus run needs at least 2 reviewer personas (got ${personas.length}).`,
                );
              }
              const chosen = new Set(personas.map((p) => p.slug));
              const shownReasons = active.filter((s) => chosen.has(s.slug));
              if (shownReasons.length > 0) {
                console.log(chalk.dim(`Reviewer selection (${selectionLabel}):`));
                for (const s of shownReasons) {
                  console.log(chalk.dim(`  • ${s.slug} — ${s.reason}`));
                }
              }
            }

            // Multi-reviewer consensus mode: the orchestrator owns all output
            // (artifacts live under reviews/run_*/), including --copy.
            if (runner && personas) {
              const est = estimateConsensusTokens(md, diff, personas.length);
              console.log(
                chalk.dim(
                  `Estimated cost: ${est.calls} AI calls (${personas.length} reviewers + judge), ~${formatTokens(est.inputTokens)} input tokens — model output/thinking and CLI overhead come on top.`,
                ),
              );
              const proceed = await confirm(
                `Run ${personas.length} reviewer passes + judge with "${runner.name}"?`,
                { interactive: interactiveMode, yes, initial: true },
              );
              if (interactiveMode && !proceed) {
                console.log(chalk.gray('Aborted before any AI calls.'));
                return;
              }
              await runConsensusReview({
                runner,
                personas,
                renderedPrompt: md,
                diff,
                outDir,
                isTTY,
                copy: opts.copy,
                then: opts.then,
              });
              return;
            }

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
            if (runner) {
              // The chat/headless session reads the prompt from disk, so the
              // file is always written in --run mode, even with --copy.
              singlePromptPath = writeSinglePrompt();
              promptLabel = singlePromptPath;
            } else {
              promptLabel = copyOnly
                ? 'clipboard only (use --out to also write a file)'
                : writeSinglePrompt();
            }
          }
          if (opts.copy) {
            const copied = await copyToClipboard(clipboardContent);
            if (!copied) {
              if (copyOnly && writeSinglePrompt && !singlePromptPath) {
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
              runner
                ? `- Handing the prompt to "${runner.name}".`
                : '- Use this prompt with your AI reviewer (paste into your AI tool).',
            ]),
          );

          if (runner && singlePromptPath) {
            console.log(
              chalk.dim(
                `Estimated cost: 1 AI call, ~${formatTokens(approxPromptTokens(clipboardContent))} input tokens — model output/thinking and CLI overhead come on top.`,
              ),
            );
            await runSingleReview(runner, singlePromptPath, { isTTY });
          }
        } catch (error: unknown) {
          console.error(chalk.red((error as Error)?.message ?? String(error)));
          process.exitCode = 1;
        }
      },
    );
}

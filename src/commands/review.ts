import { Command, InvalidArgumentError } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { loadIgnore } from '../config/ignore.js';
import {
  assertSafeRef,
  commitLog,
  currentBranch,
  fetchReviewRef,
  gitClient,
  resolveRepoRoot,
  resolveTargetRef,
} from '../git/repo.js';
import { generateUnifiedDiff } from '../git/diff.js';
import { writeDiffFile, ensureDir, writeBatchFiles } from '../formatters/diff.js';
import { annotateLineNumbers } from '../formatters/annotate.js';
import { buildPrompts } from '../formatters/prompt.js';
import { type Severity } from '../formatters/findings.js';
import { resolveBudget } from '../chunker/profiles.js';
import { header, success } from '../ux/theme.js';
import { gatherPreflight } from '../ux/preflight.js';
import { resolveRunner } from '../runners/resolve.js';
import type { ResolvedRunner } from '../runners/types.js';
import { personasBySlugs, personaPool, type Persona } from '../orchestrator/personas.js';
import { suggestPersonas, topNPersonaSlugs } from '../orchestrator/signals.js';
import { aiSuggestPersonas } from '../orchestrator/aiSelect.js';
import { runSingleReview, runConsensusReview, type PostReviewAction } from '../orchestrator/run.js';
import { estimateConsensusTokens, formatTokens } from '../orchestrator/estimate.js';
import { prBaseBranch } from '../integrations/github.js';
import { copyToClipboard } from '../ux/clipboard.js';
import { confirm, multiselect } from '../ux/prompt.js';
import { applyGate, parseSeverityOption } from './export.js';
import {
  fromCliOr,
  globalFlags,
  loadProjectConfig,
  parseBudgetOption,
  parseNonNegativeInt,
  parsePositiveInt,
  reportExcluded,
  resolveOutDir,
  resolveTemplateChoice,
  timestamp,
  withErrors,
} from './shared.js';

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

type ReviewOptions = {
  target?: string;
  pr?: number;
  mr?: number;
  template?: string;
  templatesDir?: string;
  profile?: string;
  budget?: number;
  context?: number;
  functionContext?: boolean;
  lineNumbers: boolean;
  out?: string;
  copy?: boolean;
  saveDiff?: boolean;
  switch?: boolean;
  fetch?: boolean;
  run?: string;
  iterations?: number;
  personas?: string;
  concurrency?: number;
  then?: PostReviewAction;
  failOn?: Severity;
};

export function registerReview(program: Command): void {
  program
    .command('review [ref]')
    .description(
      'Review a branch/ref (default: HEAD) or a GitHub PR / GitLab MR against the target branch',
    )
    .option(
      '--target <branch>',
      'Target branch (default: from config; for --pr, the PR base when gh is available)',
    )
    .option(
      '--pr <number>',
      'Review GitHub pull request #<number> (fetches refs/pull/<n>/head)',
      parsePositiveInt('--pr'),
    )
    .option(
      '--mr <iid>',
      'Review GitLab merge request !<iid> (fetches refs/merge-requests/<iid>/head)',
      parsePositiveInt('--mr'),
    )
    .option('--out <dir>', 'Output directory (default: reviews/)')
    .option(
      '--template <nameOrPath>',
      'Template (name or .md path; default: from config or "default")',
    )
    .option(
      '--templates-dir <dir>',
      'Directory for resolving named templates (default: ./templates)',
    )
    .option(
      '--profile <name>',
      'Budget profile; prompts larger than its token budget are split into batches (default: from .aidiff.json or generic-medium)',
    )
    .option(
      '--budget <tokens>',
      'Token budget per prompt, e.g. 200000 or 200k (overrides --profile)',
      parseBudgetOption,
    )
    .option(
      '--context <n>',
      'Lines of context around each change (git -U)',
      parseNonNegativeInt('--context'),
    )
    .option('--function-context', 'Include the whole enclosing function around each change')
    .option('--no-line-numbers', 'Do not prefix diff lines with their new-file line numbers')
    .option(
      '--copy',
      'Copy generated prompt to clipboard instead of writing a file (combine with --out or --save-diff to also write it)',
    )
    .option('--save-diff', 'Also write the raw .diff file')
    .option('--switch', 'Switch to <ref> before running review (repo stays on <ref>)')
    .option('--fetch', 'Fetch origin/<target> and origin/<ref> before running')
    .option(
      '--run <runner>',
      'Run the review with an AI runner: claude, codex, gemini, opencode, cursor, ollama:<model>, or one from config. Opens an interactive chat in a TTY; runs headless otherwise',
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
      '--concurrency <n>',
      'Reviewer passes to run in parallel (default: 3)',
      parsePositiveInt('--concurrency'),
    )
    .option(
      '--then <action>',
      "After a consensus run: 'fix' (chat to apply fixes), 'comment' (chat to draft MR/PR comments, no code changes), 'none'. Default: ask in a TTY",
      parseThen,
    )
    .option(
      '--fail-on <severity>',
      'Headless/consensus runs: exit with code 1 when a verified finding is at or above this severity',
      parseSeverityOption,
    )
    .action(withErrors(runReview));
}

async function runReview(refArg: string | undefined, opts: ReviewOptions, cmd: Command) {
  const root = await resolveRepoRoot();
  const config = loadProjectConfig(root);
  const { yes, interactive: interactiveMode } = globalFlags(cmd);
  const isTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);

  if (
    [refArg !== undefined, opts.pr !== undefined, opts.mr !== undefined].filter(Boolean).length > 1
  ) {
    throw new Error('Pass either a <ref>, --pr <number>, or --mr <iid> — not several.');
  }

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
  if (opts.failOn && !opts.run) {
    throw new Error('--fail-on needs an AI result: combine it with --run (headless or consensus).');
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
  const budget = resolveBudget({
    cliBudget: opts.budget,
    cliProfile: opts.profile,
    configBudget: config.budget,
    configProfile: config.profile,
  });

  // What is being reviewed
  let ref = refArg !== undefined ? assertSafeRef(refArg) : 'HEAD';
  let refLabel = ref;
  let targetBranch = opts.target ?? config.target;
  const remoteRequest = opts.pr !== undefined ? 'pr' : opts.mr !== undefined ? 'mr' : null;
  if (remoteRequest) {
    const number = (opts.pr ?? opts.mr) as number;
    refLabel = remoteRequest === 'pr' ? `PR #${number}` : `MR !${number}`;
    if (remoteRequest === 'pr' && !opts.target) {
      const base = await prBaseBranch(number, config.github);
      if (base) targetBranch = base;
    }
  } else if (ref === 'HEAD') {
    refLabel = (await currentBranch(root)) ?? 'HEAD';
  }

  console.log(header('diff2ai review', `ref: ${refLabel}  •  target: ${targetBranch}`));

  const git = gitClient(root);

  if (remoteRequest) {
    const spin = ora(`Fetching ${refLabel} and origin/${targetBranch}...`).start();
    ref = await fetchReviewRef(remoteRequest, (opts.pr ?? opts.mr) as number, root).catch(
      (error: Error) => {
        spin.fail(chalk.red(`Could not fetch ${refLabel}`));
        throw error;
      },
    );
    await git.fetch('origin', assertSafeRef(targetBranch, 'target branch')).catch(() => undefined);
    spin.succeed(chalk.green(`Fetched ${refLabel}`));
  } else if (opts.fetch) {
    // Optional fetch of target and/or ref regardless of switching
    await git.fetch('origin', assertSafeRef(targetBranch, 'target branch')).catch(() => undefined);
    // ref may be a commit or local-only branch, so a failed fetch is fine
    if (ref !== 'HEAD') await git.fetch('origin', ref).catch(() => undefined);
  }

  // Optional: switch to the provided ref (for agent workflows)
  if (opts.switch && ref !== 'HEAD') {
    const pre = await gatherPreflight(root);
    if ((pre.isDirty || pre.hasUntracked || pre.ongoingMerge) && !yes) {
      throw new Error(
        'Refusing to switch branches: working tree is dirty, has untracked files, or a merge is in progress. Re-run with --yes to proceed.',
      );
    }
    console.log(
      header(
        'Switching branch',
        chalk.dim(`Switching to ${refLabel}; repository will remain on this ref after review.`),
      ),
    );
    // Try git switch first; checkout also handles detached refs like refs/diff2ai/pr-12
    try {
      await git.raw(['switch', ref]);
    } catch {
      try {
        await git.checkout([ref]);
      } catch {
        throw new Error(
          `Failed to switch to ${ref}. If it's a remote branch, try: git fetch origin ${ref}:${ref}`,
        );
      }
    }
  }

  const targetRef = await resolveTargetRef(targetBranch, root);
  const spin = ora('Generating diff...').start();
  const excluded: string[] = [];
  const diff = await generateUnifiedDiff(
    {
      targetRef,
      compareRef: ref,
      contextLines: opts.context ?? config.contextLines,
      functionContext: opts.functionContext ?? config.functionContext,
      ignore: loadIgnore(root, config.exclude),
      onExclude: (f) => excluded.push(f),
    },
    root,
  );
  if (!diff || diff.trim().length === 0) {
    spin.stop();
    reportExcluded(excluded);
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
  const outDir = resolveOutDir(opts.out, root);
  let diffPath: string | undefined;
  if (opts.saveDiff) {
    diffPath = writeDiffFile('review', diff, outDir);
    spin.succeed(chalk.green(`Wrote diff: ${diffPath}`));
  } else {
    spin.succeed(chalk.green('Generated diff in memory'));
  }

  const lineNumbers = fromCliOr(cmd, 'lineNumbers', opts.lineNumbers, config.lineNumbers ?? true);
  const promptSpec = {
    ...resolveTemplateChoice(opts, config, root),
    root,
    lineNumbers,
    vars: {
      branch: refLabel,
      target: targetBranch,
      commits: await commitLog(`${targetRef}..${ref}`, root).catch(() => ''),
    },
  };
  const built = buildPrompts(diff, promptSpec, budget);

  // --copy alone means clipboard-only output; --out or --save-diff opt back into files
  const copyOnly = Boolean(opts.copy) && !opts.out && !opts.saveDiff;

  let promptLabel: string;
  let clipboardContent: string;
  let copyLabel = 'clipboard';
  let writeSinglePrompt: (() => string) | undefined;
  let singlePromptPath: string | undefined;
  if (built.kind === 'batches') {
    if (runner) {
      throw new Error(
        `Prompt (~${built.tokens} tokens) exceeds the ${budget.label} budget (${budget.budget}). ` +
          '--run needs a single prompt; retry with a larger --budget (e.g. --budget 200k) or drop --run to get batch files.',
      );
    }
    // Prompt exceeds the budget: split into template-wrapped batches.
    // Batches are always written — the clipboard can only hold one of them.
    for (const w of built.warnings) console.warn(chalk.yellow(w));
    const { indexPath } = writeBatchFiles(built.chunks, outDir);
    promptLabel = `${built.chunks.length} batch file(s) + ${path.basename(indexPath)} in ${outDir}`;
    clipboardContent = built.chunks[0].content;
    copyLabel = `clipboard (batch_1.md of ${built.chunks.length})`;
  } else {
    const md = built.prompt;
    clipboardContent = md;

    // Diff-dependent persona selection: --personas auto asks the AI
    // with a tiny change summary (heuristics as fallback); the picker
    // preselects free heuristic suggestions. The user always approves
    // the run (picker and/or the cost confirm below).
    if (runner && consensusRequested && !personas) {
      personas = await choosePersonas(runner, diff, opts, config.personas, interactiveMode);
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
      const { consolidatedPath } = await runConsensusReview({
        runner,
        personas,
        renderedPrompt: md,
        diff,
        judgeDiff: lineNumbers ? annotateLineNumbers(diff) : diff,
        outDir,
        isTTY,
        concurrency: opts.concurrency ?? config.concurrency,
        copy: opts.copy,
        then: opts.then,
      });
      applyGate(fs.readFileSync(consolidatedPath, 'utf-8'), opts.failOn);
      return;
    }

    writeSinglePrompt = () => {
      const out = diffPath
        ? diffPath.replace(/\.diff$/i, '.md')
        : path.join(outDir, `review_${timestamp()}.md`);
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
          chalk.yellow('Warning: Failed to copy to clipboard; wrote the prompt to a file instead.'),
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
        `Estimated cost: 1 AI call, ~${formatTokens(built.tokens)} input tokens — model output/thinking and CLI overhead come on top.`,
      ),
    );
    const { responsePath } = await runSingleReview(runner, singlePromptPath, { isTTY });
    if (opts.failOn) {
      if (responsePath) applyGate(fs.readFileSync(responsePath, 'utf-8'), opts.failOn);
      else
        console.warn(chalk.yellow('--fail-on was ignored: the review ran as an interactive chat.'));
    }
  }
}

async function choosePersonas(
  runner: ResolvedRunner,
  diff: string,
  opts: ReviewOptions,
  configPersonas: Record<string, string> | undefined,
  interactiveMode: boolean,
): Promise<Persona[]> {
  const suggestions = suggestPersonas(diff);
  const pool = personaPool(configPersonas);
  const reasonOf = new Map(suggestions.map((s) => [s.slug, s.reason]));
  let active = suggestions;
  let selectionLabel = 'from diff signals';
  let personas: Persona[];

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
      configPersonas,
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
      personas = personasBySlugs(picked ?? topN, configPersonas);
    } else {
      personas = personasBySlugs(topN, configPersonas);
    }
  }
  if (personas.length < 2) {
    throw new Error(`A consensus run needs at least 2 reviewer personas (got ${personas.length}).`);
  }
  const chosen = new Set(personas.map((p) => p.slug));
  const shownReasons = active.filter((s) => chosen.has(s.slug));
  if (shownReasons.length > 0) {
    console.log(chalk.dim(`Reviewer selection (${selectionLabel}):`));
    for (const s of shownReasons) console.log(chalk.dim(`  • ${s.slug} — ${s.reason}`));
  }
  return personas;
}

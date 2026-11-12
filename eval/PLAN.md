# Evaluation harness — plan (M0)

Status: recon only. No harness code exists yet and no API call has been made.
Every dollar figure below is an **estimate with stated assumptions**, not a result.
All future results will be labelled **self-run, not independently scored**.

## 1. Benchmark: verified facts

Checked on 2026-11-12 against `github.com/withmartian/code-review-benchmark`.

- Usable. MIT licence, not archived, `main` at
  `e616e849755441da38f18bf3adba2c9583b03803` (2026-08-30). **This is the pin.**
- Offline set: 5 files in `offline/golden_comments/`, 10 PRs each, 50 PRs,
  173 golden comments (Critical 12, High 54, Medium 61, Low 46).
- Pipeline (`offline/code_review_benchmark/`), all LLM calls through an
  OpenAI-compatible endpoint set by `MARTIAN_BASE_URL` / `MARTIAN_API_KEY` /
  `MARTIAN_MODEL`:
  - `step2_extract_comments` — one LLM call per review turns the review text
    into a list of issue strings ("candidates").
  - `step2_5_dedup_candidates` — one LLM call per review groups duplicates.
  - `step3_judge_comments` — one LLM call per (golden comment × candidate):
    "same underlying issue?". Writes TP/FP/FN, precision, recall per PR.
  - `analysis/score_profiles.py` — Strict / Core / All category profiles and F-beta.
- All 50 PRs and their diffs were fetched successfully with `gh api`.
  Measured sizes are in [`recon/benchmark-prs.tsv`](recon/benchmark-prs.tsv):
  1,541,360 diff bytes in total, mean 30.8 KB, median 22.4 KB, max 252 KB.

Things that differ from the brief or need care:

1. 15 of the 50 golden URLs are not upstream PRs. They are open PRs in forks
   under `ai-code-review-evaluation/*` (4 Sentry, 1 Keycloak, all 10 Discourse).
2. Three Sentry entries carry curator notes: two say "reviewed commit is not in
   the repo", one says "there is no such PR, it is a mix of many PRs" (106 files,
   252 KB diff). `sentry-greptile#1` and `#2` share one head SHA with different bases.
3. The README says inline comments become candidates directly. The code at the
   pinned commit sends **all** comment bodies through LLM extraction. We follow the code.
4. The judge hard-codes `temperature=0.0`. Anthropic's OpenAI-compatible endpoint
   returns 400 for that on Claude 4.7 and later, so a current Claude model cannot
   be the judge without editing the pipeline. Of the benchmark's three published
   judges, `claude-opus-4-5-20251101` is still active and accepts it;
   `claude-sonnet-4-5-20250929` retires on 2026-11-30; GPT-5.2 is unverified.
5. Leaderboard tools ran as GitHub apps with repository access. diff2ai sees only
   the diff. Numbers are comparable in method, not in conditions, and diff2ai does
   not meet the leaderboard's inclusion criteria. EVAL.md must say so.

## 2. How a review runs headlessly in diff2ai today

A fully headless path that returns structured findings already exists.
No change to `src/` is needed.

```
diff2ai --no-interactive --yes review <ref> --target <base> --run <runner> --out <dir>
    -> <dir>/review_<ts>.md            rendered prompt
    -> <dir>/review_<ts>.response.md   model output (issue blocks)
diff2ai export <response.md> --format json
    -> { findings: [{ severity, type, title, locations, explanation, proposedFix, verified }] }
```

- `review` builds `git diff <target>...<ref>` in a local repo, applies the
  default excludes, annotates line numbers, renders `templates/default.md`
  and pipes the prompt to the runner's stdin (`src/runners/execute.ts`).
- Consensus mode (`--personas a,b,c`) writes `run_<ts>/consolidated.md` after N
  reviewer passes, a judge pass and the mechanical diff check (`verify.ts`).
- Runners are plain commands. A custom one can be declared in `.aidiff.json`.

Gaps the harness must cover (none requires touching `src/`):

| Gap                                                                   | Handling                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| No default runner; built-in `claude` runner does not pin a model      | Eval-only runner declared in the frozen `.aidiff.json`, model ID explicit                              |
| Runner output is opaque text: no tokens, cost, model ID, duration     | The eval runner writes a usage sidecar (JSON line per call) next to the response                       |
| Default budget (`generic-medium`, 30k tokens) makes `--run` refuse    | 1 PR is certainly over (`sentry-greptile#5`, ~63k). Frozen config uses `--profile claude-large` (150k) |
| Unparseable model output yields zero findings silently                | Adapter separates "No issues found." from "no parseable block" and records the latter as an error      |
| `.aidiff.json` is read from the reviewed repo and is git-ignored here | Committed as `eval/config/aidiff.eval.json`, copied into each PR work repo                             |

## 3. Benchmark PR -> diff2ai input

The benchmark's own `step0_fork_prs.py` recreates each PR as
`base.sha` vs `pull/<n>/head`. diff2ai computes `target...ref`, the same
three-dot diff, so the input is built from the same two commits.

1. `eval/manifest.json` (committed): per PR the golden URL, owner/repo, number,
   full `base.sha` and `head.sha`, and GitHub's additions / deletions /
   changed_files. Generated once from the GitHub API, then frozen.
2. Per source repo (7 distinct), a cached partial clone outside version control
   (`eval/.cache/`, git-ignored): `git fetch --filter=tree:0 origin <base> <head>`.
   No checkout, so the work tree holds nothing but the eval `.aidiff.json`.
3. Local branches `pr-<n>` (head) and the real base branch name (base SHA), so the
   prompt reads `pr-93824 -> master`, close to real `--pr` usage, and `{commits}`
   shows the real commit messages.
4. Guard: `git diff --shortstat base...head` must match the manifest counts.
   A mismatch is recorded as `input_mismatch` and reported, never skipped silently.
5. Run the command from section 2, then `export --format json`.

Prompts are **not** committed: they embed third-party source under other licences
(Sentry is FSL). Committed instead: prompt SHA-256, config hash, the manifest.

## 4. diff2ai findings -> judge format

The judge consumes `results/benchmark_data.json` (shape of `step1` output) and
is filtered by tool name. The adapter writes that file and nothing else:

```
"<golden url>": {
  pr_title, original_url, az_comment, golden_source_file, source_repo,
  golden_comments: <copied verbatim from the pinned checkout>,
  reviews: [{ tool: "diff2ai", pr_url, repo_name,
              review_comments: [{ path, line, body, created_at }] }]
}
```

- One `review_comment` per finding. `body` is `formatInlineComment(finding)`
  from `src/integrations/format.ts`, i.e. exactly what `diff2ai post` would put
  on the PR. `path` and `line` come from the first `Affected` entry.
- Findings marked `Verification: failed` are left out, as `post` does by default.
  Their count is recorded.
- A PR with zero findings, or a failed run, still gets a review entry with an
  empty comment list. The judge then scores every golden comment as a miss.
  Failed runs are additionally listed with their error.

Then, with the pinned checkout on `PYTHONPATH` and the working directory set to
the run folder, the unmodified scripts run in order: `step2_extract_comments`,
`step2_5_dedup_candidates`, `step3_judge_comments`, all with `--tool diff2ai`,
then `analysis/score_profiles.py --all-profiles --beta 1`. The checkout is cloned
at the pinned hash into `eval/.cache/`, never vendored. Requires Python >= 3.11
and `uv` (their lockfile pins the Python dependencies).

Metrics (our aggregation, TypeScript, unit-tested against fixture
`evaluations.json` files and cross-checked against `score_profiles.py` output):

- Micro precision, recall, F1 for Strict / Core / All. Core is the leaderboard default.
- Recall by golden severity. Precision by severity is not defined by the
  benchmark: a false positive has no golden severity, and LLM extraction breaks
  the link back to diff2ai's own severity. We report diff2ai's severity mix instead.
- Findings per PR (raw findings and extracted candidates), cost and duration per PR.
- Error count, always shown next to the headline numbers.

Committed per run under `eval/results/<run-id>/`: `run.json` (diff2ai commit,
benchmark commit, config hash, model IDs, timestamps), one JSON per PR (prompt
hash, raw findings, model output, tokens, cost, duration, error), the judge's
`candidates.json`, `dedup_groups.json`, `evaluations.json`, and `summary.json`.
File names avoid this repo's ignore patterns (`*.diff`, `review_*.md`, `reviews/`).

## 5. Cost estimate

Prices from the Anthropic pricing page on 2026-11-12, USD per million tokens:
Opus 5.5 4 / 20, Sonnet 5.5 2 / 10, Haiku 5.5 0.10 / 0.50, Fable 5.2 8 / 40,
Opus 4.5 (judge) 5 / 25.

Measured input: mean diff 30,827 bytes per PR, 3.46 golden comments per PR.

Assumptions (to be replaced by measured values after the M1 smoke run):

- Prompt = diff x 1.15 (line numbers, context block) + 1,845 template bytes.
- Tokens = chars / 4 (low) to chars / 3 (high).
- Reviewer output, thinking included: 3,000 (low) to 8,000 (high) tokens per PR.
- Benchmark judge: 5 (low) to 10 (high) candidates per PR, 350 tokens in and
  100 out per comparison, plus 4,000 in and 1,000 out for extraction and dedup.
- 3- and 10-PR rows use the mean PR. Real subsets will differ.

Single reviewer pass (the baseline shape) plus the benchmark judge on Opus 4.5:

| Reviewer model      | Per PR        | 3 PRs         | 10 PRs        | 50 PRs          |
| ------------------- | ------------- | ------------- | ------------- | --------------- |
| `claude-opus-5-5`   | $0.22 – $0.40 | $0.65 – $1.21 | $2.16 – $4.02 | $10.79 – $20.09 |
| `claude-sonnet-5-5` | $0.17 – $0.30 | $0.50 – $0.89 | $1.67 – $2.97 | $8.36 – $14.85  |
| `claude-haiku-5-5`  | $0.12 – $0.20 | $0.36 – $0.59 | $1.21 – $1.97 | $6.05 – $9.86   |
| `claude-fable-5-2`  | $0.31 – $0.61 | $0.94 – $1.83 | $3.13 – $6.12 | $15.66 – $30.58 |

The benchmark judge alone is $0.12 – $0.19 per PR, about half of an Opus 5.5 run.
A consensus variant (3 reviewers + diff2ai's judge, about 4.2x reviewer cost) on
Opus 5.5 would be $26 – $54 for 50 PRs, or $21 – $43 for the 40 held-out PRs.

Whole programme (M1 + M2 + M3) on Opus 5.5: roughly $40 if the M3 variants are
cheap ones, up to roughly $130 if consensus variants are tuned and then run on
the held-out set. The brief's budget is still the placeholder `$<BUDGET>`.

Spending controls planned for M1: `npm run eval -- --estimate` renders the real
prompts locally (free) and prints the estimate; a run needs `--approve-usd <n>`;
a running tally aborts the run above 1.25x the approved figure and records it.

## 6. Open questions (need a decision before M1)

1. **Budget.** `$<BUDGET>` was never filled in. What is the total?
2. **Reviewer model for the baseline.** diff2ai has no default runner.
   Proposed: `claude-opus-5-5`, default effort, single pass, `default` template.
3. **How the reviewer model is called.** Proposed: an eval-only runner script
   using the official `@anthropic-ai/sdk` as a **new devDependency** (needs
   approval). It gives a pinned model ID and exact tokens. Alternative without a
   new dependency: the built-in `claude` CLI runner plus `--model`, which adds
   Claude Code's own system prompt and reports no token usage in text mode.
4. **Judge model and endpoint.** Proposed: `claude-opus-4-5-20251101` through
   `https://api.anthropic.com/v1/` with `ANTHROPIC_API_KEY`, so one key
   reproduces everything. Alternative: a Martian key, matching the published runs.
5. **Python and `uv` as prerequisites** for the judge step. Needed to run the
   benchmark's pipeline unmodified. Acceptable?
6. **Budget profile.** `claude-large` in the frozen config, the one departure
   from defaults. Otherwise `sentry-greptile#5` fails by design. Agree?
7. **Judge token accounting.** The unmodified pipeline logs no usage. Proposed:
   a local pass-through proxy in the harness that forwards requests unchanged,
   logs only the `usage` field (never headers) and enforces the cost cap.
   Alternative: report judge cost in aggregate from the provider console.
8. **Dev / held-out split timing.** Proposed: commit the seeded split (2 dev and
   8 held-out per repo) in M1, before any result exists, since M2 also runs the 40.
9. **Smoke subset.** Proposed: `grafana-90939` (1 KB), `sentry-93824` (19 KB),
   `discourse-graphite-4` (29 KB, a fork PR with 8 golden comments).
10. **Clone size.** Treeless fetches of 7 repos download full commit graphs.
    Fallback if too slow: a synthetic two-commit history from the same trees,
    which loses the real commit messages in the prompt.

# Evaluation

> **Self-run, not independently scored.** The diff2ai maintainers ran this
> evaluation themselves with the harness in [`eval/`](eval/). Nobody outside the
> project has reproduced or checked it.

diff2ai was measured on the offline set of Martian's
[Code Review Bench](https://github.com/withmartian/code-review-benchmark): 50
pull requests from five open-source projects, with 173 human-verified "golden"
review comments and an LLM judge that decides whether a tool's findings match them.

## Baseline result

Run `m2-baseline`, all 50 PRs, one pass each, benchmark's default Core profile:

| Precision | Recall | F1    | Golden comments found | Missed | Unmatched candidates |
| --------- | ------ | ----- | --------------------- | ------ | -------------------- |
| 26.8%     | 72.8%  | 39.2% | 115                   | 43     | 314                  |

In plain terms: diff2ai's review found about three of every four issues the
benchmark expects, and about one in four of the points the judge extracted from
its comments matched an expected issue. An unmatched point is not necessarily
wrong (see [Limitations](#limitations)).

These numbers should not be placed next to the benchmark's public leaderboard.
The tools there ran as GitHub apps with access to the repository; diff2ai saw
only the diff.

## Method

1. **Benchmark, pinned.** The benchmark repository is cloned at commit
   `e616e849755441da38f18bf3adba2c9583b03803` into a local cache. Its code is not
   copied into this repository and its golden comments are not edited.
2. **Input.** For each PR, the base and head commits recorded in
   [`eval/manifest.json`](eval/manifest.json) are fetched from GitHub. The local
   diff must match GitHub's file and line counts, or the PR is recorded as an error.
3. **Review.** `diff2ai review <head> --target <base> --run <runner>` runs
   headlessly with the packaged `default` template. The runner is a small
   script that sends the prompt to the Claude API as one message. The only
   departure from diff2ai's defaults is the token budget profile
   (`claude-large`), because one PR exceeds the default budget.
4. **Adapter.** Each finding becomes one review comment with the same body
   `diff2ai post` would write on the PR.
5. **Judge.** The benchmark's own scripts run unmodified: they extract
   individual issues ("candidates") from the comments, group duplicates, and
   ask the judge model whether each candidate matches each golden comment.
6. **Scores.** Precision, recall and F1 are micro-averaged over PRs, using the
   benchmark's category profiles. This repository's aggregation is checked
   against the benchmark's own scoring script, whose output is committed with
   every run (`judge/score_profiles.txt`).

A PR whose review fails still counts: it is sent to the judge with no comments,
so all its golden comments count as missed, and the failure is listed.

## Versions

|                |                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| diff2ai        | 0.3.0 at commit `623bf39`, config [`eval/config/baseline.json`](eval/config/baseline.json), config hash `5935c17b5b37` |
| Benchmark      | `withmartian/code-review-benchmark` at `e616e84`, offline set                                                          |
| Reviewer model | `claude-opus-5-5`, effort `medium`, single pass, no fallback model                                                     |
| Judge model    | `claude-opus-4-5-20251101`, one of the benchmark's three published judges                                              |
| Claude API SDK | `@anthropic-ai/sdk` 1.8.0                                                                                              |
| Environment    | Node 24.22.1 on Windows, uv 0.11.26, Python 3.11.9                                                                     |
| Run date       | 2026-11-12 (UTC)                                                                                                       |

## Baseline in detail

All figures below come from [`eval/results/m2-baseline/`](eval/results/m2-baseline/)
(`summary.json`, `by-source.json`, `judge/calls.jsonl`).

**By profile.** A profile selects which categories of golden comment count.

| Profile        | Precision | Recall | F1    | TP  | FP  | FN  |
| -------------- | --------- | ------ | ----- | --- | --- | --- |
| Strict         | 24.2%     | 71.9%  | 36.2% | 100 | 314 | 39  |
| Core (default) | 26.8%     | 72.8%  | 39.2% | 115 | 314 | 43  |
| All            | 28.1%     | 71.1%  | 40.3% | 123 | 314 | 50  |

**Recall by severity of the golden comment** (Core). Precision by severity is
not defined in this benchmark: an unmatched candidate has no golden severity.

| Severity | Found | Total | Recall |
| -------- | ----- | ----- | ------ |
| Critical | 9     | 12    | 75.0%  |
| High     | 44    | 54    | 81.5%  |
| Medium   | 43    | 59    | 72.9%  |
| Low      | 19    | 33    | 57.6%  |

**By source repository** (Core, 10 PRs each).

| Source    | Language   | Precision | Recall | F1    | TP  | FP  | FN  | Findings/PR | Cost/PR |
| --------- | ---------- | --------- | ------ | ----- | --- | --- | --- | ----------- | ------- |
| cal.com   | TypeScript | 27.2%     | 75.7%  | 40.0% | 28  | 75  | 9   | 7.00        | $0.369  |
| Discourse | Ruby       | 33.0%     | 76.3%  | 46.0% | 29  | 59  | 9   | 5.80        | $0.303  |
| Grafana   | Go         | 22.7%     | 68.0%  | 34.0% | 17  | 58  | 8   | 4.70        | $0.225  |
| Keycloak  | Java       | 22.4%     | 68.0%  | 33.7% | 17  | 59  | 8   | 5.20        | $0.295  |
| Sentry    | Python     | 27.6%     | 72.7%  | 40.0% | 24  | 63  | 9   | 6.00        | $0.314  |

**Findings.** 287 findings, 5.74 per PR: 3 critical, 41 high, 119 medium,
122 low, 2 info. The judge's extraction step turned them into 450 candidates,
1.57 per finding.

**Failures.** 0 failed reviews and 0 failed judge comparisons. 149 of the 2,034
judge-side calls were rate-limited and retried by the benchmark's pipeline.

**Time.** 36 seconds per review on average, 14 minutes 21 seconds for the whole run.

**Cost.** $15.06 in total, $0.30 per PR: $7.07 for the reviewer (813,396 input
and 190,917 output tokens) and $7.98 for the benchmark's judge.

## Experiment

One experiment was run, with its plan and success criterion committed before
any variant ran. Full protocol and results: [`eval/EXPERIMENT.md`](eval/EXPERIMENT.md).

The 50 PRs were split by a fixed seed into 10 for development and 40 held out.
Three variants ran on the development PRs: three reviewer personas with
diff2ai's consensus judge, a cheaper reviewer model (`claude-sonnet-5-5`), and
posting only findings of medium severity or higher. The cheaper model scored
best there and was run once on the held-out PRs.

**It did not improve on the baseline. It was worse.**

| Held-out, 40 PRs, Core | Precision | Recall | F1    | Findings/PR | Cost/PR |
| ---------------------- | --------- | ------ | ----- | ----------- | ------- |
| Baseline               | 26.9%     | 71.3%  | 39.1% | 5.78        | $0.302  |
| Cheaper reviewer model | 23.1%     | 65.1%  | 34.1% | 4.35        | $0.212  |

The F1 difference is -4.9 points, with a 95% paired bootstrap interval of -9.5
to -0.8. The lead it had on the development PRs (+5.8 points on 10 PRs) did not
hold on 40.

The experiment changed nothing in diff2ai's defaults. What it did show:

- Ten PRs are too few to choose a configuration on.
- Multi-reviewer consensus scored lower than a single pass on the 10
  development PRs (F1 30.5% against 39.7%, same recall, more unmatched
  findings, 2.8 times the cost). That is ten PRs and one run, not a held-out
  result, so it is a lead to follow up rather than a conclusion.
- Filtering to medium severity and above raised precision by 5.6 points and
  cut recall by 24.1, leaving F1 unchanged, again on 10 PRs.

## Cost of the whole evaluation

Computed from logged token counts and the list prices in the config, not from
an invoice.

| Run                 | PRs | Purpose                      | Cost       |
| ------------------- | --- | ---------------------------- | ---------- |
| `m1-smoke`          | 3   | Plumbing check               | $0.93      |
| `m2-baseline`       | 50  | Baseline                     | $15.06     |
| `m3-dev-baseline`   | 10  | Baseline repeated, for noise | $2.90      |
| `m3-dev-sonnet`     | 10  | Variant on development PRs   | $1.45      |
| `m3-dev-min-medium` | 10  | Variant on development PRs   | $2.46      |
| `m3-dev-consensus3` | 10  | Variant on development PRs   | $8.26      |
| `m3-heldout-sonnet` | 40  | Chosen variant, held out     | $8.49      |
| **Total**           |     |                              | **$39.55** |

## Limitations

- **Self-run.** The people who build diff2ai chose the setup, ran it and
  wrote this page.
- **Possible training-data exposure.** The PRs are public and come from
  well-known repositories. The reviewer and judge models may have seen these
  PRs, their later fixes, or the benchmark itself during training. The
  benchmark's authors name this as a known limitation of the offline set.
- **Small sample.** 50 PRs and 173 golden comments. The per-repository rows
  rest on 10 PRs each, and severity rows on as few as 12 comments.
- **One baseline run.** The baseline ran once on all 50 PRs. Run-to-run
  variation was only sampled on the 10 development PRs: two baseline runs gave
  the same Core totals there, with different per-PR counts.
- **Not the leaderboard's conditions.** diff2ai reviewed the diff alone, with
  no repository access, and its comments reached the judge through this
  repository's adapter instead of being posted on GitHub.
- **Unmatched does not mean wrong.** The golden set lists selected issues per
  PR, not every valid one. Nobody checked the 314 unmatched candidates by
  hand, so the true share of incorrect findings is unknown.
- **Precision depends on the judge's extraction step.** The judge model splits
  each comment into separate issues before matching. It produced 1.57
  candidates per finding in the baseline and 2.18 in the held-out variant run.
  A comment that makes several points is counted several times.
- **One judge model.** The benchmark publishes results under three judges and
  reports that they differ. Only `claude-opus-4-5-20251101` was used here. If
  it is retired, the baseline cannot be re-judged the same way.
- **Benchmark quirks.** 15 of the 50 golden entries are PRs recreated in fork
  repositories, and three Sentry entries carry curator notes such as "there is
  no such PR, it is a mix of many PRs". They were used as published.
- **One platform.** All runs were made on Windows.

## Reproduce

Requirements: Node 22.13 or newer, git, [uv](https://docs.astral.sh/uv/) and
Python 3.11 or newer (for the benchmark's own scripts), an `ANTHROPIC_API_KEY`
in the environment, about 5 GB of free disk for the cached repositories, and
about $15 to $22 of API usage.

```bash
npm ci
```

```bash
npm run eval -- --all --approve-estimate --run-id my-baseline
```

The command prints a cost estimate, runs the 50 reviews and the judge (about 15
minutes), stops by itself if spending passes 125% of the estimate, and writes
`eval/results/my-baseline/`. Without `--approve-estimate` it prints the
estimate and exits. To see how far a new run is from the committed baseline:

```bash
npm run eval:compare -- --base m2-baseline --variant my-baseline
```

Expect differences of a few points: model output varies between runs, and the
judge's extraction step varies too. `budgetUsd` in the config is this
project's own spending limit and counts the runs already committed here.

Two checks need no API key:

```bash
npx vitest run tests/eval
```

```bash
npm run eval -- --subset cal.com-14943,sentry-77754 --mock --run-id dry-run
```

The first runs the adapter, metric and statistics tests. The second exercises
the whole path, including the benchmark's scripts, against mocked models; its
scores mean nothing and it writes outside `eval/results/`.

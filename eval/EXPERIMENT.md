# M3 experiment

## Part 1 — plan, written before any variant was run

This part was committed before the first variant run. The commit order in git is
the evidence. Results are added below it afterwards and this part is not edited.

### Question

Does a different diff2ai configuration review better than the baseline on this
benchmark?

The baseline (`config/baseline.json`, run `m2-baseline`, all 50 PRs) scored
Core precision 26.8%, recall 72.8%, F1 39.2%. Recall is the strong side and
precision the weak one, so two of the three variants aim at precision.

### Variants

Each differs from the baseline in exactly one setting.

| Variant      | Change                                                                 | Expectation                                                     |
| ------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `consensus3` | `--iterations 3`: three reviewer personas, diff2ai's judge, diff check | Judge drops weak findings: precision up, recall about the same  |
| `sonnet`     | Reviewer model `claude-sonnet-5-5` instead of `claude-opus-5-5`        | Similar F1 at about half the reviewer cost                      |
| `min-medium` | Post only findings at MEDIUM or above (`post --min-severity MEDIUM`)   | Precision up at no extra cost, some recall lost on Low comments |

### Protocol

1. **Split.** `eval/split.json` (seed 20261112): 10 development PRs, 40 held out,
   two development PRs per source repository. Committed in M1, before any result.
2. **Development runs.** Each variant runs once on the 10 development PRs.
   The baseline also runs once more on them, so that two baseline samples
   (this one and the development part of `m2-baseline`) show run-to-run noise.
3. **Selection.** The variant with the highest Core F1 on the development PRs
   is chosen. Within one F1 point, the cheaper one wins. Variants are not
   changed after the development results are seen: one round, no re-tuning.
4. **Held-out run.** The chosen variant runs once on the 40 held-out PRs and is
   compared with the baseline's results on the same 40 PRs from `m2-baseline`.
5. **Reporting.** The held-out result is reported whatever it is, including if
   it is worse than the baseline or if no variant beat the baseline in step 3.

### Success criterion

Primary metric: micro-averaged F1 on the benchmark's Core profile.

The chosen variant counts as **an improvement** only if both hold on the 40
held-out PRs:

- its Core F1 is higher than the baseline's, and
- the 95% interval of the F1 difference excludes zero, using a paired bootstrap
  over PRs (10,000 resamples, seed 20261112).

Anything else is reported as **no demonstrated improvement**.

Reported alongside, without a pass or fail: precision, recall, recall by golden
severity, findings per PR, cost per PR, and the Strict and All profiles.

### Weaknesses known in advance

- One run per configuration on the held-out set. The bootstrap interval covers
  which PRs were sampled, not the run-to-run variation of the reviewer and the
  judge. The repeated baseline in step 2 gives a rough size for that.
- Ten development PRs are few. The selection in step 3 may be decided by noise.
- The baseline's held-out totals were already known when the variants were
  chosen, because M2 runs all 50 PRs first. While verifying M2, the judge's
  output for one held-out PR (`sentry-95633`) was read to see how the judge
  splits findings into candidates. The variants come from the brief's examples
  and existing diff2ai settings; none was designed from that reading.
- All results are self-run, not independently scored.

### Spending plan

About $16 had been spent before M3. Expected for M3: roughly $15 to $20 for the
four development runs and up to roughly $30 for the held-out run if `consensus3`
is chosen, well inside the $200 budget.

## Part 2 — results

Added on 2026-11-13, after the runs. All numbers are **self-run, not
independently scored**, on the benchmark's Core profile unless stated. Every
figure comes from the `compare-vs-m2-baseline-*.json` file in the named run's
folder under `eval/results/`.

### Outcome

**No demonstrated improvement.** The chosen variant, `sonnet`, scored lower than
the baseline on the 40 held-out PRs: Core F1 34.1% against 39.1%. The
difference is -4.9 points with a 95% paired bootstrap interval of -9.5 to -0.8,
so on this run the variant was worse, not just unproven.

### Development runs (10 PRs)

"F1 change" is against the development part of `m2-baseline`, with the 95%
paired bootstrap interval.

| Run                 | Precision | Recall | F1    | TP  | FP  | FN  | Findings/PR | Cost/PR | F1 change            |
| ------------------- | --------- | ------ | ----- | --- | --- | --- | ----------- | ------- | -------------------- |
| `m2-baseline` (dev) | 26.4%     | 79.3%  | 39.7% | 23  | 64  | 6   | 5.60        | $0.297  |                      |
| `m3-dev-baseline`   | 26.4%     | 79.3%  | 39.7% | 23  | 64  | 6   | 6.10        | $0.290  | +0.0 (-8.0 to +6.6)  |
| `m3-dev-sonnet`     | 33.9%     | 69.0%  | 45.5% | 20  | 39  | 9   | 4.50        | $0.145  | +5.8 (-9.5 to +16.4) |
| `m3-dev-min-medium` | 32.0%     | 55.2%  | 40.5% | 16  | 34  | 13  | 6.20        | $0.246  | +0.9 (-7.6 to +15.0) |
| `m3-dev-consensus3` | 18.9%     | 79.3%  | 30.5% | 23  | 99  | 6   | 8.60        | $0.826  | -9.2 (-13.6 to -4.2) |

- The two baseline samples have the same Core totals. That is a coincidence of
  the totals: the per-PR counts differ, and so do the Strict and All totals.
- `min-medium` posted 32 of its 62 findings; the other 30 were below MEDIUM.

**Selection.** `sonnet` had the highest development Core F1, five points above
the next variant, so it went to the held-out run as the rule required.

### Held-out run (40 PRs)

| Run                      | Precision | Recall | F1    | TP  | FP  | FN  | Findings/PR | Cost/PR | Review time/PR |
| ------------------------ | --------- | ------ | ----- | --- | --- | --- | ----------- | ------- | -------------- |
| `m2-baseline` (held-out) | 26.9%     | 71.3%  | 39.1% | 92  | 250 | 37  | 5.78        | $0.302  | 36 s           |
| `m3-heldout-sonnet`      | 23.1%     | 65.1%  | 34.1% | 84  | 279 | 45  | 4.35        | $0.212  | 12 s           |

Differences, variant minus baseline, with 95% paired bootstrap intervals:

| Profile | F1                  | Precision           | Recall               |
| ------- | ------------------- | ------------------- | -------------------- |
| Core    | -4.9 (-9.5 to -0.8) | -3.8 (-7.1 to -0.6) | -6.2 (-15.3 to +2.1) |
| Strict  | -4.0 (-8.3 to +0.0) | -3.1 (-6.1 to -0.2) | -4.4 (-14.0 to +4.4) |
| All     | -4.2 (-8.7 to -0.0) | -3.4 (-6.7 to -0.1) | -4.3 (-13.1 to +3.9) |

Recall by golden severity, Core: Critical 8 of 8 (baseline 7 of 8), High 31 of
45 (36), Medium 31 of 47 (33), Low 14 of 29 (16).

### What the experiment showed

- **The development result did not hold.** `sonnet` was +5.8 F1 on 10 PRs and
  -4.9 on 40. Its development interval (-9.5 to +16.4) already said the lead
  could be noise; the held-out run confirmed it. Ten PRs are too few to select on.
- **The cheaper reviewer saved less than expected.** Reviewer cost for the 40
  PRs fell from $5.64 to $1.85, but total cost per PR only from $0.302 to
  $0.212, because the benchmark's judge ($6.64) costs more than the reviewer.
- **Fewer findings did not mean fewer false positives.** `sonnet` wrote 4.35
  findings per PR against 5.78, yet the judge's extraction step turned them
  into more candidates (379 against 358: 2.18 per finding against 1.55), and
  false positives rose from 250 to 279. Precision here depends on how the
  judge splits a comment, not only on how many comments the tool writes.
- **Consensus looked worse on the development PRs.** `consensus3` found the same
  golden comments as the baseline but produced 99 false positives against 64,
  at 2.8 times the cost per PR. Its interval excludes zero, but this is ten PRs
  and one run, with no held-out confirmation. It is a lead to follow up, not a
  finding.
- **The severity filter traded recall for precision.** `min-medium` gained 5.6
  points of precision and lost 24.1 of recall (interval -40.0 to -10.5), leaving
  F1 unchanged.

### Departures from the plan

None in the protocol. M3 cost $23.56 ($15.07 for the four development runs,
$8.49 for the held-out run) against the planned $15 to $20 plus up to $30.

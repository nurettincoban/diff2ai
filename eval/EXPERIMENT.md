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

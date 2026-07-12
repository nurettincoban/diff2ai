# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`review --run <runner>`**: execute the review with an AI CLI. In a TTY, `--run claude` opens an interactive Claude Code chat seeded with the review prompt; in scripts/CI it runs headlessly and saves the response as `*.response.md`. Custom runners are configurable in `.aidiff.json` under `runners`.
- **Smart persona selection**: `--personas auto` asks the AI to choose reviewers from a compact change summary (file stats + capped sample, one small call — never the full diff), with free local heuristics as fallback. The heuristics also power the interactive picker's preselection (auth/SQL → Security Auditor, routes/schemas → API reviewer, code without test changes → Test Engineer, with reasons shown) and the top-N default for non-interactive `--iterations N`.
- **Post-judge verification gate**: every consolidated finding's `Affected:` reference is mechanically checked against the diff (file present, lines within changed hunks). Failures are demoted to an "⚠ Unverified findings" section with the reason, and `post` skips them unless `--include-unverified` is passed.
- **`interactive`** (alias `i`): guided wizard — pick the branch (current preselected), target (config default preselected), review mode (AI chat / consensus / prompt-only), runner, personas, and post-review outcome; prints the equivalent `diff2ai review ...` one-liner before running it.
- **`clean`**: delete diff2ai-generated artifacts from the output directory (`run_*` dirs, timestamped prompts/diffs, batches, responses) with `--keep <n>` and `--dry-run`; user files are never touched, and deleting requires interactive confirmation or `--yes`.
- **`post <review.md>`**: turn any diff2ai review into a single formatted GitLab MR comment (severity badges, consensus scores, collapsible findings) and post it via the user's authenticated `glab` CLI. `--mr <iid>`, `--min-severity`, `--dry-run`; posting always requires consent (interactive prompt or explicit `--yes`). diff2ai still makes no network calls itself.
- **`review --personas <slugs>`** and an interactive persona picker: choose exactly which reviewers run instead of the first n; `--then fix|comment|none` controls what happens after consolidation (apply fixes, draft MR/PR review comments without code changes, or nothing — asked interactively in a TTY when unset).
- Pre-run cost transparency: consensus runs print the number of AI calls and estimated input tokens (from the actual prompt + diff) and ask for confirmation in interactive mode; long passes show elapsed time and stream artifacts to `reviews/run_*/` as they finish.
- **`review --iterations <n>`**: multi-reviewer consensus mode. Runs n independent headless passes with distinct reviewer personas (Bug Hunter, Security Auditor, Performance Engineer, API & Maintainability, Test Engineer — extendable via `personas` config), then a judge pass that validates every finding against the diff (discarding hallucinated ones), deduplicates, and emits a consolidated review with `Consensus: k/N reviewers` scores. Artifacts under `reviews/run_<timestamp>/`; in a TTY a chat opens afterwards to walk through the findings.

- `exclude` patterns in `.aidiff.json` are now actually applied when generating diffs (merged with `.aidiffignore`). Lockfiles, `dist/` output, and minified files are excluded by default; set `exclude: []` to disable.
- CLI now reports how many files were excluded by ignore/exclude patterns instead of dropping them silently.
- `npm run typecheck` script covering `src/`, `tests/`, and build config.
- GitHub Actions CI (lint, typecheck, tests on Linux/macOS across Node 18/20/22).
- LICENSE, CONTRIBUTING, issue/PR templates.

### Fixed

- Merge/rebase-in-progress detection: preflight previously read fields that don't exist on simple-git's status result, so `review --switch` could switch branches mid-merge. It now checks the git dir markers (`MERGE_HEAD`, `rebase-merge`, ...).

### Removed

- Unimplemented `include` field in `.aidiff.json` (was documented but never applied). Use `exclude` / `.aidiffignore` to filter.
- Stale planning documents and a stale legacy ESLint config.

## [0.2.1] - 2026-07

### Fixed

- `review --copy` no longer writes the prompt file unless `--out` or `--save-diff` is passed; if the clipboard is unavailable it falls back to writing the file so the prompt is never lost.

## [0.2.0] - 2026-07

### Fixed

- Unified diffs are no longer corrupted when filtering ignored files.
- `.aidiffignore` is applied consistently across `diff`, `show`, and `review`.
- `review --profile` is honored (was previously ignored).

## [0.0.6] - 2025

### Added

- Packaged templates usable by name without copying (`security`, `api-best-practices`, `reliability`, `event-driven`, `basic`, `default`).
- `templates` command to list project and packaged templates.
- Custom template support: names, file paths, `--templates-dir`, and `.aidiff.json` `template`/`templatesDir`.

## [0.0.5] - 2025

### Added

- `review --switch` and `review --fetch` flags.
- `--copy` clipboard support.
- Default `reviews/` output directory.
- Initial MVP: `review`, `diff`, `show`, `prompt`, `chunk`, `doctor` commands.

[Unreleased]: https://github.com/nurettincoban/diff2ai/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.2.1
[0.2.0]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.2.0
[0.0.6]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.0.6
[0.0.5]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.0.5

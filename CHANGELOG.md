# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10

First npm release since 0.1.2, so it also ships the 0.2.x fixes listed below. Requires Node.js 22.13+.

### Breaking

- Node.js >= 22.13 (18 and 20 are end-of-life). The package now ships a single ESM CLI bundle (no CJS build, no type declarations).
- `diff` (without `--staged`) now diffs your working tree, committed and uncommitted changes, against the merge base with the target, as its description always said. Use `--committed` for the previous `target...HEAD` behavior.
- `chunk` wraps batches in your template (`--template`, config `template`, default `default`) instead of a fixed header.
- Every command exits non-zero on failure, including refused or failed `review --switch` and invalid targets (several used to exit 0).
- Default output directory is `reviews/` at the repo root, even when run from a subdirectory.
- An explicit `--templates-dir` / `templatesDir` that does not exist is now an error instead of being silently ignored.
- `--no-interactive` also makes `review --run` headless instead of opening a chat.

### Added

- **Review a PR/MR by number**: `review --pr <n>` (GitHub) and `review --mr <iid>` (GitLab) fetch the head into `refs/diff2ai/*` without touching your branches; for `--pr` the target defaults to the PR's base branch when `gh` is available. `review` with no ref reviews the current branch.
- **GitHub posting**: `post` detects GitHub/GitLab from `origin`; on GitHub, findings on changed lines become inline review comments via `gh` (anything else goes in the review body, with a single-comment fallback). `--pr`, `--no-inline`, `--platform`.
- **`export`**: findings as JSON or SARIF 2.1.0 (for GitHub code scanning), `--min-severity`, `--include-unverified`.
- **Severity gates**: `--fail-on <severity>` on `export` and on headless/consensus `review --run` runs.
- **`latest`** as the review argument of `post` and `export` (newest `consolidated.md` / `*.response.md`).
- **GitHub Action** (`action.yml`): review PRs in CI with any runner, post inline comments, write SARIF, gate on severity.
- **Runner presets**: `codex`, `gemini`, `opencode`, `cursor`, and `ollama:<model>` for local models, alongside `claude`.
- **Line-numbered diffs**: prompt diffs are prefixed with new-file line numbers so reviewers cite exact `path:line` locations (`--no-line-numbers` / `lineNumbers: false` to disable).
- **Context placeholders** for templates: `{commits}` (commit subjects and bodies), `{file_stats}`, `{branch}`, `{target}`.
- **`agent` template** for reviewers with repository access; the `default` template now works for both chat and agents.
- **Prompt-injection guard**: packaged templates, persona and judge prompts treat the diff and commit messages as untrusted data; follow-up chats are told to verify findings, not obey them.
- `--context <n>` and `--function-context` on `review`, `diff`, and `show`; `contextLines` / `functionContext` in config.
- `--budget <tokens>` (and config `budget`) for any token budget; batches count template overhead, and oversized files are split at hunk boundaries.
- Consensus reviewer passes run in parallel (`--concurrency`, config `concurrency`, default 3).
- `doctor` shows config status and which AI runners and posting CLIs are installed.
- **`review --run <runner>`**: execute the review with an AI CLI. In a TTY it opens an interactive chat seeded with the review prompt; in scripts/CI it runs headless and saves `*.response.md`. Custom runners are configurable in `.aidiff.json` under `runners`.
- **`review --iterations <n>`**: multi-reviewer consensus mode with distinct personas and a judge pass that validates findings against the diff, deduplicates, and scores `Consensus: k/N reviewers`. Artifacts under `reviews/run_<timestamp>/`.
- **Smart persona selection**: `--personas auto` (AI picks from a compact change summary, heuristics fallback), `--personas <slugs>`, and an interactive picker with suggestions.
- **Post-judge verification gate**: consolidated findings are mechanically checked against the diff; failures are demoted to an "Unverified findings" section and skipped by `post`/`export` unless `--include-unverified`.
- **`--then fix|comment|none`** after consensus runs; cost estimate and confirmation before AI calls.
- **`interactive`** (alias `i`) guided wizard; it only offers runners that are installed.
- **`post <review.md>`** for GitLab MRs via `glab`, with `--mr`, `--min-severity`, `--dry-run`.
- **`clean`**: delete diff2ai-generated artifacts with `--keep <n>` and `--dry-run`.
- `exclude` patterns in `.aidiff.json` are applied (merged with `.aidiffignore`); lockfiles, `dist/`, and minified files are excluded by default. The CLI reports how many files were excluded.
- CI on Linux, macOS, and Windows (Node 22/24) plus a packed-tarball smoke test; tag releases publish to npm with trusted publishing (OIDC) and create a GitHub Release.
- LICENSE, CONTRIBUTING, issue/PR templates, `.gitattributes`.

### Fixed

- Running any command from a subdirectory of the repo failed with "Not a git repository".
- User git config (`color.ui=always`, `diff.noprefix`, `diff.mnemonicPrefix`, `diff.external`) could inject ANSI codes into prompts and silently bypass `.aidiffignore`; diff output is now pinned.
- `template` in `.aidiff.json` was never applied (the CLI default always won).
- `show <ref>` crashed for refs containing `/` (the ref was used in the file name); files are now named by short SHA.
- `doctor` always reported "Last fetch: unknown" (it read HEAD's reflog, which never records fetches).
- Ignore filtering rewrote CRLF line endings, so saved diffs of CRLF files no longer applied with `git apply`.
- AI runners installed through npm on Windows (`.cmd` shims) failed to start; processes now spawn through `cross-spawn`.
- Merge/rebase-in-progress detection read fields that don't exist on simple-git's status result, so `review --switch` could switch branches mid-merge.
- `templates` ignored `templatesDir` from config; the `diff` target picker listed `origin/HEAD`.
- Comment footers claimed "cross-validated by multiple reviewers" for single-pass reviews.

### Security

- `simple-git` ^3.36.0 and `minimatch` ^10.2.6 (critical/high advisories in the previous lockfile).
- Refs starting with `-` are rejected before reaching git, so a crafted ref cannot become a git option.
- Replaced the unmaintained `prompts` package with `@inquirer/prompts`.

### Removed

- Unimplemented `include` field in `.aidiff.json` (was documented but never applied). Use `exclude` / `.aidiffignore`.
- The redundant custom `help` command (commander's built-in `help [command]` remains).
- Stale planning documents and a legacy ESLint config.

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

[Unreleased]: https://github.com/nurettincoban/diff2ai/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.3.0
[0.2.1]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.2.1
[0.2.0]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.2.0
[0.0.6]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.0.6
[0.0.5]: https://github.com/nurettincoban/diff2ai/releases/tag/v0.0.5

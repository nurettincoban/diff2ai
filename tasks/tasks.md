# diff2ai – MVP Task Breakdown

This document translates the PRD into small, focused tasks that can be executed independently by an AI coding agent or a human contributor. Each task has clear outcomes and acceptance criteria. Check off boxes as you complete items.

Notes
- Keep solutions simple and aligned with the PRD.
- Prefer iterating on working code; avoid unnecessary abstractions.
- All code must have tests (unit and/or integration) and pass linting.

---

## 0. Project Scaffolding & Tooling

- [x] Initialize npm package with CLI bin `diff2ai`
  - Outcome: `package.json` with `bin.diff2ai`, project metadata, scripts
  - Accept: `npx diff2ai --help` prints usage (after build)

- [x] Add TypeScript setup
  - Outcome: `tsconfig.json` with Node 18 target, strict on
  - Accept: `tsx` can run TS files locally, build succeeds

- [x] Add bundler with `tsup`
  - Outcome: `tsup.config.ts` for ESM/CJS as needed, source maps off by default
  - Accept: `npm run build` produces `dist/` with single CLI entry

- [x] Linting & formatting
  - Outcome: ESLint + Prettier config and scripts
  - Accept: `npm run lint` and `npm run format` succeed with no errors

- [x] Testing harness
  - Outcome: Vitest configured for unit/integration; `test/` folders recognized
  - Accept: `npm test` runs example test

---

## 1. Directory Structure

- [x] Create source layout
  - Outcome: `src/cli.ts`, `src/commands/`, `src/git/`, `src/formatters/`, `src/chunker/`, `templates/`
  - Accept: Files present and export stubs compile

---

## 2. CLI Framework (commander)

- [x] Bootstrap CLI with Commander
  - Outcome: `src/cli.ts` registers commands, global `--version`, `--help`
  - Accept: Running CLI shows top-level help and subcommands

---

## 3. Configuration & Ignore

- [x] Load `.aidiff.json` (JSON5 supported)
  - Outcome: `src/config/loadConfig.ts` reads config, merges defaults
  - Accept: Missing file falls back to defaults with warning

- [x] Implement `.aidiffignore` with `minimatch`
  - Outcome: `src/config/ignore.ts` filters paths from diffs
  - Accept: Files matching ignore patterns are excluded from outputs

---

## 4. Git Utilities (simple-git)

- [x] Repo detection and guardrails
  - Outcome: `src/git/repo.ts` checks for `.git` and repo health
  - Accept: Clear error message if not a git repo

- [x] Remote branch discovery
  - Outcome: Helper to list `git branch -r` for suggestions
  - Accept: On invalid target, suggestions are printed

- [x] MR/PR fetch helpers (GitHub/GitLab)
  - Outcome: `src/git/fetch.ts` with functions for PR/MR fetch refs
  - Accept: Graceful failure prints manual command as per PRD

- [x] Diff generation helpers
  - Outcome: `src/git/diff.ts` supports: range diff `origin/<target>...HEAD`, staged `--staged`, and commit `git show -p <sha>`
  - Accept: Returns unified diff string; performs include/exclude filtering

---

## 5. Commands

- [x] `mr` command
  - Outcome: `diff2ai mr --id <num> --target <branch>`
  - Behavior: Fetches remote ref; generates diff vs target branch
  - Accept: Writes `<platform>_<id>_*.diff` to disk and prints path

- [x] `diff` command
  - Outcome: `diff2ai diff [--staged]`
  - Behavior: Without flags: `origin/<target>...HEAD`; with `--staged`: staged diff
  - Accept: Writes timestamped `*.diff` file to disk

- [x] `show` command (commit-by-commit)
  - Outcome: `diff2ai show <sha>`
  - Behavior: Writes `commit_<sha>_*.diff`
  - Accept: File exists with unified diff content

- [x] `prompt` command
  - Outcome: `diff2ai prompt <path/to.diff> [--template <basic|comprehensive|security>]`
  - Behavior: Generates AI-ready markdown per template, writes `*.md`
  - Accept: Default is comprehensive; placeholders replaced; file path printed

- [x] `chunk` command
  - Outcome: `diff2ai chunk <path/to.diff> [--profile <claude-large|generic-large|generic-medium>]`
  - Behavior: Splits into batches with overlap and file-boundary preference; emits `batch_*.md` and `review_index.md`
  - Accept: Profiles map to token budgets; index links all batches

---

## 6. Templates & Formatters

- [x] Embed built-in templates
  - Outcome: `templates/basic.md`, `templates/comprehensive.md`, `templates/security.md`
  - Accept: Placeholders `{diff_content}` replaced correctly

- [x] Markdown formatter
  - Outcome: `src/formatters/markdown.ts` fills templates safely (escape where needed)
  - Accept: Snapshot tests for each template pass

- [x] Diff writer
  - Outcome: `src/formatters/diff.ts` writes `.diff` files with consistent naming
  - Accept: Predictable timestamped file names in project root

---

## 7. Chunking Engine

- [x] Define model profiles and budgets
  - Outcome: `src/chunker/profiles.ts` with `claude-large`, `generic-large`, `generic-medium`
  - Accept: Budgets match PRD

- [ ] Preserve function/class boundaries
  - Outcome: `src/chunker/boundaries.ts` detects blocks in unified diffs
  - Accept: When splitting, functions/classes are not broken mid-block

- [x] Context overlap
  - Outcome: 20-line context added between adjacent chunks
  - Accept: Overlap verified in tests

- [x] Related changes grouping
  - Outcome: Prefer same-file grouping; do not split small related hunks
  - Accept: Heuristic covered by tests on synthetic diffs

- [x] Batch generation and index
  - Outcome: `batch_*.md` and `review_index.md` with links
  - Accept: All batches self-contained; index lists batch file names

---

## 8. Error Handling (per PRD)

- [x] MR/PR fetch failures print manual commands
  - Accept: Exact phrasing matches PRD example

- [x] Missing Git repo message
  - Accept: Clear guidance to initialize or change directory

- [x] Invalid diff target suggests available branches
  - Accept: Shows `git branch -r` results

- [ ] Large file warnings and auto-chunk prompt
  - Accept: Detect when diff likely exceeds profile budget; suggest `chunk`

- [x] Config errors fallback with warning
  - Accept: Explicit warning with path and field name

---

## 9. Performance

- [ ] Process <1000 LOC diffs in <2s
  - Outcome: Simple benchmark script and test fixture repository
  - Accept: CI/integration log shows elapsed time under target on typical machine

---

## 10. Cross-Platform

- [ ] Verify Linux/macOS/Windows path handling
  - Outcome: Avoid POSIX-only calls; normalize paths
  - Accept: Unit tests cover path joins and temp dirs on all platforms

---

## 11. Tests

- [ ] Unit tests: config, ignore, diff parsing, chunking, templates
  - Accept: Coverage for edge cases (empty diffs, binary files notice, huge hunks)

- [ ] Integration tests: CLI end-to-end on temp git repo
  - Accept: `mr`, `diff`, `show`, `prompt`, `chunk` workflows verified

- [ ] Snapshot tests for template outputs
  - Accept: Stable outputs across runs

---

## 12. Documentation

- [x] README with quickstart
  - Outcome: Install, usage examples, troubleshooting, performance note
  - Accept: Commands mirror PRD exactly

- [ ] Example configuration files
  - Outcome: `.aidiff.json` and `.aidiffignore` examples
  - Accept: Users can copy-paste to start

- [ ] Changelog for MVP
  - Outcome: `CHANGELOG.md` with initial release notes
  - Accept: Links to PRD

---

## 13. Packaging & Release

- [ ] Prepare for npm publish
  - Outcome: Proper `files` field, `license`, `keywords`, repository metadata
  - Accept: `npm pack` produces expected tarball; `npx` works locally

---

## 14. Nice-to-Have (Post-MVP)

- [ ] Basic telemetry toggle (local only, off by default)
- [ ] Configurable output directory
- [ ] Colorized CLI output via `chalk` across all commands

---

## Task Dependencies Overview

- Scaffolding → Directory Structure → CLI Framework → Git Utilities → Commands
- Templates/Formatters ↔ Chunking Engine → Chunk Command
- Error Handling and Performance are cross-cutting and should be validated last

---

## Definition of Done (MVP)

- All tasks in sections 0–13 checked
- `npx diff2ai --help` works after install
- Commands `mr`, `diff`, `show`, `prompt`, `chunk` function as specified
- Tests pass; lint passes; build succeeds
- README and examples updated



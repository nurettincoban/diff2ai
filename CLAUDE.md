# diff2ai — agent guide

TypeScript ESM CLI (`commander`) that turns Git diffs into AI-ready code-review prompts, optionally runs them through an AI CLI, and posts results via `gh`/`glab`. diff2ai itself makes no network calls.

## Commands

- `npm run dev -- <args>` — run CLI from source (tsx)
- `npm run build` — tsup → `dist/cli.js` (single ESM bundle, copies `templates/`)
- `npm test` — builds first, then vitest; integration tests execute `dist/cli.js` in throwaway git repos under `os.tmpdir()`
- `npm run typecheck` / `npm run lint` — must be green before committing; CI enforces both (Linux, macOS, Windows × Node 22/24)

## Architecture

- `src/cli.ts` — program setup, global `--yes` / `--no-interactive`
- `src/commands/shared.ts` — `withErrors` (every action: red message + exit code 1), `globalFlags`, `resolveOutDir` (default `<repo root>/reviews`), `resolveTemplateChoice` (CLI paths vs cwd, config paths vs root), `fromCliOr` (CLI value only when actually passed)
- `src/commands/index.ts` — `diff`, `show`, `prompt`, `chunk`, `templates`; `review`, `post`, `export`, `clean`, `doctor`, `interactive` live in their own files
- `src/git/repo.ts` — `gitClient` (core.quotePath=false), `resolveRepoRoot` (works from subdirectories), `assertSafeRef` (rejects refs starting with `-`), `resolveTargetRef` (prefers `origin/<branch>`), `fetchReviewRef` (`--pr`/`--mr` → `refs/diff2ai/*`), `commitLog` (`{commits}`)
- `src/git/diff.ts` — `generateUnifiedDiff` with `SAFE_DIFF_FLAGS` (no color, no ext diff, fixed a/ b/ prefixes) + section-level ignore filtering (byte-preserving)
- `src/git/diffParse.ts` — the only diff parser: headers (quoted/spaced paths), hunk walking by counts, `buildDiffIndex`, `diffFileStats`. Don't add new `diff --git` regexes elsewhere
- `src/config/loadConfig.ts` — `.aidiff.json` (JSON5); `src/config/ignore.ts` — config `exclude` + `.aidiffignore` (minimatch, `dot: true`)
- `src/chunker/` — `approxTokens` (~4 chars/token), `resolveBudget` (--budget > --profile > config), batch packing by file then hunk, template overhead counted
- `src/formatters/` — `markdown.ts` (template resolution: explicit path → project `templates/` → packaged; placeholders `{diff_content}` required, `{commits}` `{file_stats}` `{branch}` `{target}` optional, one-pass substitution), `annotate.ts` (new-file line numbers), `prompt.ts` (render single prompt or batches), `findings.ts` (issue-block parser), `export.ts` (JSON/SARIF), `reviewFile.ts` (`latest`, filtering, severity gate)
- `src/runners/` — runner presets (`builtin.ts`: claude, codex, gemini, opencode, cursor, `ollama:<model>`), config merge, and `execute.ts`, the only module that spawns processes (cross-spawn; headless = stdin or prompt file, interactive = `stdio: 'inherit'` seeded with a file-reference instruction, never the full prompt in argv)
- `src/orchestrator/` — consensus flow: `personas.ts`, `signals.ts`/`aiSelect.ts` (persona suggestions), `judge.ts`, `verify.ts` (mechanical check of judge findings), `run.ts` (parallel passes via `runPool`, failure policy: continue if ≥2 succeed, artifacts under `reviews/run_<timestamp>/`)
- `src/integrations/` — `format.ts` (shared comment markdown), `github.ts` (gh: PR lookup, PR diff, review with inline comments + fallback), `gitlab.ts` (glab MR note)
- `action.yml` — composite GitHub Action wrapping `review --pr`, `post`, `export`

## Tests

- Git identity/defaults come from `tests/fixtures/gitconfig` via `GIT_CONFIG_GLOBAL` (vitest.config.ts) — don't rely on the machine's git config
- `tests/helpers.ts` has `repoWithOrigin`, `diff2ai`, `runFail`, `readReview`
- AI runners are stubbed with `tests/fixtures/fake-runner.mjs` (`FAKE_RUNNER_FAIL_MATCH`, `FAKE_RUNNER_EMPTY`, `FAKE_RUNNER_SLEEP_MS`, `FAKE_RUNNER_LOG`); gh/glab with `fake-gh.mjs` / `fake-glab.mjs` via `.aidiff.json` `github`/`gitlab.command` — never invoke real AI or hosting CLIs in tests
- `tests/regressions.it.test.ts` holds one test per fixed bug

## Conventions

- ESM with `.js` extensions on relative imports (NodeNext)
- Import simple-git as named `{ simpleGit }`, and create clients with `gitClient()`
- Commands throw errors; `withErrors` prints them and sets the exit code
- Conventional Commits; update CHANGELOG.md `[Unreleased]` with user-facing changes
- Output defaults to `reviews/` at the repo root; never write elsewhere without an explicit `--out`

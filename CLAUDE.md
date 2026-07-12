# diff2ai — agent guide

TypeScript ESM CLI (`commander`) that turns Git diffs into AI-ready code-review prompts. Pure git, no network calls.

## Commands

- `npm run dev -- <args>` — run CLI from source (tsx)
- `npm run build` — tsup → `dist/` (esm+cjs, dts, copies `templates/`)
- `npm test` — builds first, then vitest; integration tests execute `dist/cli.js` in throwaway git repos under `os.tmpdir()`
- `npm run typecheck` / `npm run lint` — must be green before committing; CI enforces both

## Architecture

- `src/cli.ts` — program setup, global `--yes` / `--no-interactive`
- `src/commands/index.ts` — `diff`, `show`, `prompt`, `chunk`, `templates`; `review.ts` and `doctor.ts` register their own commands
- `src/git/diff.ts` — `generateUnifiedDiff` + per-file ignore filtering of the unified diff text
- `src/git/repo.ts` — `resolveTargetRef` prefers `origin/<branch>`, falls back to local
- `src/config/loadConfig.ts` — `.aidiff.json` (JSON5): `target`, `profile`, `exclude`, `template`, `templatesDir`
- `src/config/ignore.ts` — merges config `exclude` globs with `.aidiffignore` (minimatch, `dot: true`)
- `src/chunker/` — `approxTokens` (~4 chars/token) and batch splitting per profile budget
- `src/formatters/markdown.ts` — template resolution order: explicit path → project `templates/` → packaged `dist/templates/`; templates must contain `{diff_content}`
- `src/runners/` — AI runner abstraction for `review --run` (built-in `claude`; custom via `.aidiff.json` `runners`); `execute.ts` is the only module that spawns child processes (headless = prompt via stdin, interactive = `stdio: 'inherit'` seeded with a file-reference instruction, never the full prompt in argv)
- `src/orchestrator/` — `--iterations` consensus flow: `personas.ts` (5 built-ins, config-extendable), `judge.ts` (validation/dedup/consensus prompt + output sanity check), `run.ts` (sequential passes, failure policy: continue if ≥2 succeed, artifacts under `reviews/run_<timestamp>/`)
- `src/formatters/findings.ts` — parses the issue-block schema back out of review markdown; `src/integrations/gitlab.ts` + `src/commands/post.ts` — format findings as one MR comment and post via `glab` (config `gitlab.command` overrides the binary; posting requires interactive consent or `--yes`)
- Tests stub AI runners with `tests/fixtures/fake-runner.mjs` (env knobs: `FAKE_RUNNER_FAIL_MATCH`, `FAKE_RUNNER_EMPTY`, `FAKE_RUNNER_SLEEP_MS`) — never invoke the real `claude` in tests

## Conventions

- ESM with `.js` extensions on relative imports (NodeNext)
- Import simple-git as named `{ simpleGit }` (default import breaks under NodeNext typecheck)
- Conventional Commits
- Output defaults to `reviews/` in the user's cwd; never write elsewhere without an explicit `--out`

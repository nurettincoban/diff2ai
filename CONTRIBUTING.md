# Contributing to diff2ai

Thanks for your interest in contributing! This project is intentionally focused: turn Git diffs into high-signal AI code reviews, locally, with no network calls made by diff2ai itself (AI CLIs, `gh` and `glab` do their own).

## Development setup

Requirements: Node.js >= 22.13 and Git.

```bash
git clone https://github.com/nurettincoban/diff2ai.git
cd diff2ai
npm install
```

Useful scripts:

| Script              | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Run the CLI from source (`tsx src/cli.ts`)      |
| `npm run build`     | Build `dist/` with tsup (also copies templates) |
| `npm test`          | Build, then run the vitest suite                |
| `npm run typecheck` | Type-check `src/`, `tests/`, and config files   |
| `npm run lint`      | ESLint (flat config, includes Prettier)         |
| `npm run format`    | Prettier write                                  |

Try your local build against any repo:

```bash
npm run build
node /path/to/diff2ai/dist/cli.js review my-branch --target main
```

## Project layout

- `src/cli.ts` — commander setup, global flags
- `src/commands/` — one file per command (`review`, `post`, `export`, `clean`, `doctor`, `interactive`; `diff`/`show`/`prompt`/`chunk`/`templates` in `index.ts`) plus `shared.ts` (error handling, flags, path resolution)
- `src/git/` — repo root and ref helpers (`repo.ts`), diff generation with pinned output flags (`diff.ts`), and the one diff parser everything uses (`diffParse.ts`)
- `src/chunker/` — token budgets and batch splitting (by file, then hunk)
- `src/formatters/` — templates, line-number annotation, prompt building, findings parsing, JSON/SARIF export
- `src/config/` — `.aidiff.json` loading and `.aidiffignore` / exclude patterns
- `src/runners/` — AI runner presets and execution; `execute.ts` is the only module that spawns child processes
- `src/orchestrator/` — consensus flow: personas, judge prompt, verification gate, parallel runs, token estimate
- `src/integrations/` — GitHub (`gh`) and GitLab (`glab`) posting
- `templates/` — packaged review templates (copied into `dist/templates` at build)
- `action.yml` — the GitHub Action
- `tests/` — vitest suites; most are integration tests that run the built CLI against throwaway git repos in `os.tmpdir()` (see `tests/helpers.ts`). Git config comes from `tests/fixtures/gitconfig`; AI runners, `gh` and `glab` are stubbed with fixtures — never invoke a real AI or hosting CLI in tests

## Guidelines

1. Keep changes small and focused; one concern per PR.
2. Add or update tests for any behavior change. Integration tests that exercise the built CLI are preferred (see existing tests for the tmp-repo pattern).
3. Make sure `npm test`, `npm run lint`, and `npm run typecheck` all pass locally — CI runs them on Linux, macOS, and Windows with Node 22 and 24.
4. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:`, `chore:`...).
5. Templates must contain the `{diff_content}` placeholder — it's validated at render time.
6. New user-facing behavior needs a README update and a `CHANGELOG.md` entry under `[Unreleased]` in the same PR.
7. Bug fixes get a regression test (`tests/regressions.it.test.ts` collects them).

## Reporting bugs / requesting features

Open an issue with the provided templates. For bugs, include your OS, Node version, the exact command you ran, and (if possible) a minimal repro.

## Releasing (maintainers)

Releases are published by `.github/workflows/release.yml` when a `vX.Y.Z` tag is pushed. It runs lint, typecheck and tests, checks the tag matches `package.json`, publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no token; provenance is automatic), and creates a GitHub Release from the matching `CHANGELOG.md` section.

```bash
# 1. Move [Unreleased] entries into a new "## [X.Y.Z] - YYYY-MM" section in CHANGELOG.md
npm version X.Y.Z --no-git-tag-version
git commit -am "chore(release): X.Y.Z"
git tag vX.Y.Z
git push origin main vX.Y.Z

# 2. Point the GitHub Action's major tag at the release
git tag -f v1 vX.Y.Z
git push -f origin v1
```

One-time setup on npmjs.com: package settings → Trusted publishing → GitHub Actions, with repository `nurettincoban/diff2ai` and workflow `release.yml`.

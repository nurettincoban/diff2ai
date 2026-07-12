# Contributing to diff2ai

Thanks for your interest in contributing! This project is intentionally small and focused: turn Git diffs into high-signal AI review prompts, locally, with zero network calls.

## Development setup

Requirements: Node.js >= 18 and Git.

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
- `src/commands/` — one file per command area (`review`, `doctor`, everything else in `index.ts`)
- `src/git/` — repo assertions, ref resolution, unified diff generation and ignore filtering
- `src/chunker/` — token-budget profiles and diff chunking for large changes
- `src/formatters/` — diff/batch file writing and template rendering
- `src/config/` — `.aidiff.json` loading and `.aidiffignore` / exclude patterns
- `src/runners/` — AI runner abstraction for `review --run` (built-in `claude`, custom via config); `execute.ts` is the only module that spawns child processes
- `src/orchestrator/` — `--iterations` consensus flow: personas, judge prompt, run orchestration, token estimate
- `templates/` — packaged review templates (copied into `dist/templates` at build)
- `tests/` — vitest suites; most are integration tests that run the built CLI against throwaway git repos in `os.tmpdir()`. AI runners are stubbed with `tests/fixtures/fake-runner.mjs` — never invoke a real AI in tests

## Guidelines

1. Keep changes small and focused; one concern per PR.
2. Add or update tests for any behavior change. Integration tests that exercise the built CLI are preferred (see existing tests for the tmp-repo pattern).
3. Make sure `npm test`, `npm run lint`, and `npm run typecheck` all pass locally — CI runs them on Linux and macOS across Node 18/20/22.
4. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages (`feat:`, `fix:`, `docs:`, `chore:`...).
5. Templates must contain the `{diff_content}` placeholder — it's validated at render time.
6. New user-facing behavior needs a README update in the same PR.

## Reporting bugs / requesting features

Open an issue with the provided templates. For bugs, include your OS, Node version, the exact command you ran, and (if possible) a minimal repro.

## Releasing (maintainers)

```bash
npm version <patch|minor|major>
git push --follow-tags
npm publish
```

Update `CHANGELOG.md` as part of the release commit.

# diff2ai

[![CI](https://github.com/nurettincoban/diff2ai/actions/workflows/ci.yml/badge.svg)](https://github.com/nurettincoban/diff2ai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/diff2ai.svg?logo=npm&label=npm)](https://www.npmjs.com/package/diff2ai)
[![npm downloads](https://img.shields.io/npm/dm/diff2ai.svg?color=blue)](https://www.npmjs.com/package/diff2ai)
![node version](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Turn your Git diffs into high-signal AI code reviews — with the AI you already use, locally, from your terminal or CI.

- 🤖 **Any AI CLI**: `--run claude | codex | gemini | opencode | cursor | ollama:<model>` — or just copy the prompt into any chat
- 🧑‍⚖️ **Multi-reviewer consensus**: several reviewer personas run in parallel, then a judge validates every finding against the diff, and a mechanical check demotes anything that points outside the change
- 🎯 **Line-accurate findings**: diffs are annotated with real line numbers and enriched with commit messages and a file summary, so reviews cite the right `file:line`
- 💬 **Posts where you review**: inline comments on GitHub PRs (via `gh`) or a formatted note on GitLab MRs (via `glab`)
- 🚦 **CI-ready**: a [GitHub Action](#-github-action), SARIF export for code scanning, and `--fail-on high` severity gates
- ⚡️ **Local-first**: pure git; nothing leaves your machine unless _you_ run an AI or post a comment
- 🧩 **Big diffs welcome**: token-budgeted batches that split at file and hunk boundaries

Quick links: [Install](#-installation) • [Quickstart](#-quickstart) • [Runners](#-run-the-ai---run) • [Consensus](#%EF%B8%8F-multi-reviewer-consensus---iterations) • [GitHub & GitLab](#-post-to-github-or-gitlab) • [GitHub Action](#-github-action) • [Commands](#-commands) • [Templates](#-templates) • [Configuration](#%EF%B8%8F-configuration)

---

## ✨ Why diff2ai?

Pasting a raw diff into a chat window gets you noisy, unstructured feedback with made-up line numbers. diff2ai builds a focused prompt from your actual change — line-numbered diff, commit messages, file summary — with a strict output schema, so the review you get back has severities, exact file/line references, and concrete fixes. Then it can run the AI for you, cross-check several reviewers, and post the result on your PR.

|                       | diff2ai                                                         | Hosted review bots              | Pasting a diff into a chat |
| --------------------- | --------------------------------------------------------------- | ------------------------------- | -------------------------- |
| Where your code goes  | Only to the AI CLI you choose (or nowhere: prompt-only mode)    | The vendor's service            | The chat provider          |
| Model                 | Claude, Codex, Gemini, OpenCode, Cursor, local Ollama, your own | The vendor's choice             | Whatever you paste into    |
| Cost                  | Your existing AI subscription or API key                        | Usually a per-seat subscription | Your chat subscription     |
| Hallucination defense | Consensus across personas + judge + mechanical diff check       | Varies                          | None                       |
| Line references       | Line-numbered diff, verified against the hunks                  | Yes                             | Often wrong                |
| Setup                 | `npm i -g diff2ai`                                              | App install and org permissions | None                       |

## 📦 Installation

Requires Node.js >= 22.13 and git.

```bash
npm i -g diff2ai        # global install (recommended)
diff2ai --version

npx diff2ai --help      # or run without installing
diff2ai doctor          # checks the repo and which AI / posting CLIs are installed
```

## 🚀 Quickstart

```bash
# Guided wizard: branch → target → mode → reviewers → outcome
diff2ai interactive     # or: diff2ai i

# Review your current branch against main and open a Claude chat about it
diff2ai review --run claude

# Serious mode: 3 reviewer personas in parallel + a validating judge
diff2ai review --run claude --iterations 3

# Review a GitHub PR or GitLab MR by number (no checkout needed)
diff2ai review --pr 128 --run codex
diff2ai review --mr 42 --run gemini

# Classic mode: just generate the prompt and copy it for any AI tool
diff2ai review feature/my-branch --target main --copy
```

## 🤖 Run the AI (`--run`)

`--run <runner>` hands the generated prompt to an AI CLI:

- **In a terminal (TTY)** it opens the tool's interactive chat seeded with the review prompt.
- **In scripts/CI (non-TTY)** it runs headless and saves the structured review next to the prompt as `*.response.md`.

| Runner           | CLI                                                                 | Headless mode used                                  |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `claude`         | [Claude Code](https://code.claude.com/docs/en/setup)                | `claude -p --tools ""` (no tools, no saved session) |
| `codex`          | [OpenAI Codex CLI](https://github.com/openai/codex)                 | `codex exec --sandbox read-only --ephemeral -`      |
| `gemini`         | [Gemini CLI](https://github.com/google-gemini/gemini-cli)           | prompt on stdin, `--output-format text`             |
| `opencode`       | [opencode](https://opencode.ai/docs/)                               | `opencode run --agent plan` (read-only agent)       |
| `cursor`         | [Cursor CLI](https://cursor.com/docs/cli/overview) (`cursor-agent`) | `-p --mode ask` (read-only), reads the prompt file  |
| `ollama:<model>` | [Ollama](https://ollama.com) with a local model                     | `ollama run <model>` (headless only)                |

The presets follow each tool's documented flags; CLIs move fast, so if one changes, override it (same name) or add your own in `.aidiff.json`:

```json5
{
  runners: {
    mytool: {
      command: 'mytool',
      args: ['--model', 'fast'], // always prepended
      headless: { args: ['--pipe'], input: 'stdin' }, // or input: 'promptFileArg' with {promptFile} in args
      interactive: { args: ['{promptFileInstruction}'] }, // or false if the tool has no seeded chat
      timeoutMs: 600000,
    },
  },
}
```

Large prompts never go through argv: headless runners read stdin (or a prompt file), and interactive chats get a one-line instruction pointing at the prompt file.

## 🧑‍⚖️ Multi-reviewer consensus (`--iterations`)

One AI review can hallucinate or miss things. `--iterations 3` runs **independent reviewer passes**, each with a different persona, then a **judge pass** that cross-checks everything:

```bash
diff2ai review feature/payments --run claude --iterations 3
```

1. **Reviewers are suggested, and you approve.** `--personas auto` asks the AI to pick reviewers from a tiny summary of the change (one small call, not a full diff read), falling back to free local heuristics. In a terminal, the picker opens with heuristic suggestions preselected and labeled with _why_ (auth/SQL → Security Auditor, code without test changes → Test Engineer, ...). `--personas correctness,security` stays fully manual.

   | Persona (slug)                                         | Focus                                           |
   | ------------------------------------------------------ | ----------------------------------------------- |
   | Bug Hunter (`correctness`)                             | logic errors, edge cases, broken error handling |
   | Security Auditor (`security`)                          | injection, authz/authn, secrets, unsafe input   |
   | Performance Engineer (`performance`)                   | complexity, N+1, leaks, blocking I/O            |
   | API & Maintainability Reviewer (`api-maintainability`) | interfaces, breaking changes, coupling          |
   | Test Engineer (`testing-edge-cases`)                   | missing coverage, brittle tests, boundaries     |

   Add your own (or override a built-in) under `personas` in `.aidiff.json`.

2. **You approve the cost first.** Before any AI call, diff2ai prints the estimated input tokens and number of calls and asks to proceed (`--yes` skips).
3. **Reviewers run in parallel** (3 at a time by default; `--concurrency 1` for sequential, e.g. to stay inside tight rate limits). Artifacts appear under `reviews/run_*/` as each pass finishes.
4. The judge receives the line-numbered diff (ground truth) plus all reviews and must **validate every finding against the diff**, deduplicate, and score consensus.
5. **A mechanical gate re-checks the judge.** diff2ai locally verifies every consolidated finding's `Affected:` file and lines against the actual diff (zero tokens). Failures are demoted to an "⚠ Unverified findings" section, and `post`/`export` skip them by default (`--include-unverified` to override).
6. You get one consolidated review where every issue carries a `Consensus: k/N reviewers` line. Then choose (or preset with `--then`): **fix** — a chat verifies findings against the codebase and applies fixes; **comment** — a chat drafts ready-to-paste review comments into `comments.md` without touching code; **none** — keep the files.

**Cost, honestly:** every reviewer is a full model invocation over your whole diff, plus the judge. Use 2–3 targeted personas, tighten `exclude` patterns, and keep plain `--run` for everyday changes; save consensus for risky PRs.

## 💬 Post to GitHub or GitLab

`diff2ai post <review>` turns any diff2ai review (a consensus `consolidated.md`, a headless `*.response.md`, or `latest`) into comments on your PR/MR, through **your own authenticated CLI** — diff2ai never handles tokens.

- **GitHub** ([`gh`](https://cli.github.com)): findings on changed lines become **inline review comments**; anything that can't be anchored goes in the review body. If GitHub rejects the review, diff2ai falls back to a single PR comment.
- **GitLab** ([`glab`](https://gitlab.com/gitlab-org/cli)): one formatted MR note with severity badges and collapsible findings.

```bash
diff2ai post latest --dry-run                     # preview
diff2ai post latest                               # platform detected from origin; asks before posting
diff2ai post latest --pr 128 --min-severity MEDIUM
diff2ai post reviews/run_*/consolidated.md --mr 42 --yes
```

| Flag                        | Effect                                                          |
| --------------------------- | --------------------------------------------------------------- |
| `--platform github\|gitlab` | Override auto-detection (from the `origin` remote)              |
| `--pr <n>` / `--mr <iid>`   | Target PR/MR (default: the one for the current branch)          |
| `--no-inline`               | GitHub: one PR comment instead of a review with inline comments |
| `--min-severity <sev>`      | Only post findings at or above this severity                    |
| `--include-unverified`      | Also post findings that failed the mechanical diff check        |
| `--dry-run`                 | Print instead of posting                                        |

Posting always requires consent: interactive mode asks, non-interactive mode requires `--yes`.

## 🚦 GitHub Action

Review every pull request with your AI of choice and post inline comments:

```yaml
# .github/workflows/ai-review.yml
name: AI review
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: nurettincoban/diff2ai@v1
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          runner: claude # codex, gemini, opencode, cursor, ...
          iterations: 3 # 1 = single pass
          min-severity: MEDIUM
          fail-on: CRITICAL # optional severity gate
          # sarif-file: diff2ai.sarif  # then upload with github/codeql-action/upload-sarif
```

Inputs: `runner`, `iterations`, `personas`, `template`, `target`, `post`, `inline`, `min-severity`, `fail-on`, `sarif-file`, `install-runner`, `version`, `github-token` (see [action.yml](action.yml)). The action reads the diff only; it never executes code from the PR. Use the `pull_request` trigger: pull requests from forks don't receive your secrets, so the AI step won't run for them.

### CI without the action

```bash
diff2ai --no-interactive --yes review --pr "$PR" --target main --run claude --iterations 3 --then none
diff2ai --yes post latest --pr "$PR"
diff2ai export latest --format sarif --out diff2ai.sarif
diff2ai export latest --fail-on HIGH > /dev/null     # exit code 1 when a verified HIGH+ finding exists
```

### Pre-push hook

Get a quick review of what you're about to push (`.git/hooks/pre-push`, made executable):

```bash
#!/bin/sh
diff2ai --no-interactive review --run claude --fail-on CRITICAL || {
  echo "diff2ai found CRITICAL issues — see reviews/*.response.md (push with --no-verify to skip)"
  exit 1
}
```

## 🧰 Commands

### `review [ref]` — end to end

Diffs `ref` (default: your current branch) against the target branch (three-dot: `target...ref`) and renders an AI prompt — then optionally runs it.

```bash
diff2ai review                                   # current branch vs main → reviews/review_<timestamp>.md
diff2ai review feature/payments --copy           # clipboard only, no file
diff2ai review --pr 128                          # GitHub PR head (fetched into refs/diff2ai/pr-128)
diff2ai review --function-context --template security
```

| Flag                      | Effect                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--target <branch>`       | Target branch (default: `target` from `.aidiff.json`, else `main`; with `--pr`, the PR's base via gh) |
| `--pr <n>` / `--mr <iid>` | Review a GitHub PR / GitLab MR by number; fetches its head and the target                             |
| `--template <name\|path>` | Template name (project or packaged) or a direct `.md` path                                            |
| `--templates-dir <dir>`   | Where to resolve named templates (default: `./templates`)                                             |
| `--context <n>`           | Lines of context around each change (git `-U<n>`)                                                     |
| `--function-context`      | Include the whole enclosing function around each change                                               |
| `--no-line-numbers`       | Don't prefix diff lines with their new-file line numbers                                              |
| `--budget <tokens>`       | Token budget per prompt (e.g. `200k`); larger diffs are split into batches                            |
| `--profile <name>`        | Named budget: `generic-medium` (30k, default), `generic-large` (100k), `claude-large` (150k)          |
| `--copy`                  | Copy the prompt to the clipboard instead of writing a file                                            |
| `--save-diff`             | Also write the raw `.diff`                                                                            |
| `--out <dir>`             | Output directory (default: `reviews/` at the repo root)                                               |
| `--switch`                | Switch to `ref` first; refuses if dirty/untracked/mid-merge unless `--yes`                            |
| `--fetch`                 | `git fetch origin <target>` and `<ref>` first                                                         |
| `--run <runner>`          | Execute the review with an AI runner (see [Runners](#-run-the-ai---run))                              |
| `--iterations <n>`        | Consensus mode: n persona passes + validating judge (requires `--run`, n ≥ 2)                         |
| `--personas <slugs>`      | Reviewer personas: comma-separated slugs, or `auto`                                                   |
| `--concurrency <n>`       | Reviewer passes in parallel (default 3)                                                               |
| `--then <action>`         | After consensus: `fix`, `comment`, or `none`                                                          |
| `--fail-on <severity>`    | Headless/consensus runs: exit 1 when a verified finding is at or above this severity                  |

If the prompt exceeds the budget, diff2ai writes `batch_*.md` files plus a `review_index.md` with merge instructions (files are split at file and then hunk boundaries; with `--copy`, batch 1 goes to the clipboard). `--run` needs one prompt, so oversized diffs are refused with a hint to raise `--budget`.

### The rest

```bash
diff2ai interactive            # guided wizard
diff2ai post <review|latest>   # post findings to a GitHub PR or GitLab MR
diff2ai export <review|latest> # findings as JSON or SARIF (--format sarif, --fail-on HIGH)
diff2ai clean                  # delete generated artifacts in reviews/ (--keep 3, --dry-run)
diff2ai diff                   # your work vs target (committed + uncommitted) → reviews/diff_<timestamp>.diff
diff2ai diff --committed       # only committed changes (target...HEAD)
diff2ai diff --staged          # staged changes → reviews/staged_<timestamp>.diff
diff2ai show <commit>          # one commit (SHA, branch, HEAD~1...) → reviews/commit_<sha>_<timestamp>.diff
diff2ai prompt <file.diff>     # render a prompt from an existing diff (--template, --out)
diff2ai chunk <file.diff>      # split a big diff into template-wrapped batch_*.md (--budget, --template)
diff2ai templates              # list project + packaged templates
diff2ai doctor                 # repo state, config, installed AI / posting CLIs
```

Every command works from any subdirectory of the repo. Global flags: `--no-interactive` (no prompts, for CI) and `--yes` (auto-confirm safe prompts).

## 🧱 Templates

Packaged templates (use by name):

| Template             | Focus                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `default`            | Strict, structured general review; works in chats and coding agents    |
| `agent`              | For agents with repo access: verify every finding against the codebase |
| `basic`              | Lightweight, minimal instructions                                      |
| `security`           | Injection, authz/authn, secrets, unsafe deserialization                |
| `api-best-practices` | REST/HTTP semantics, versioning, error contracts                       |
| `reliability`        | Error handling, retries, timeouts, resource leaks                      |
| `event-driven`       | Message contracts, idempotency, ordering, delivery semantics           |

Packaged templates enforce numbered issue blocks — no preamble, no diff echo — and treat the diff as untrusted input (instructions hidden in a PR are reported, not followed):

```text
## <n>) Severity: CRITICAL|HIGH|MEDIUM|LOW|INFO | Type: Implementation|Bug|Security|Test|Performance|Style|Doc|Maintainability
Title: <short imperative>

Affected:
- path/to/file.ext:lineStart-lineEnd

Explanation:
<what is wrong, why it matters, how to fix>

Proposed fix:
~~~<lang>
<minimal snippet or steps>
~~~
```

### What the AI sees

Diff lines are prefixed with their line number in the new file, so reviewers that only see the diff (like a web chat) can cite exact locations:

```text
@@ -10,4 +10,5 @@ function main() {
  10    const a = 1;
      -  const b = 2;
  11 +  const b = 3;
  12 +  const c = 4;
```

### Custom templates

Any `.md` file containing `{diff_content}` works. Optional placeholders add context:

| Placeholder      | Replaced with                                                         |
| ---------------- | --------------------------------------------------------------------- |
| `{diff_content}` | The (line-numbered) diff — required                                   |
| `{commits}`      | Commit subjects and bodies in the reviewed range: the author's intent |
| `{file_stats}`   | Changed files with status and `+/-` counts                            |
| `{branch}`       | The ref under review (e.g. `feature/x`, `PR #128`)                    |
| `{target}`       | The branch it is compared against                                     |

Missing values render as `(not available)`.

```bash
diff2ai review feature/api --template my-template          # resolves ./templates/my-template.md
diff2ai review feature/api --template ./docs/review.md     # or a direct path
diff2ai review feature/api --templates-dir ./my-templates --template code-review
```

Resolution order: direct path → project `templates/` (or `--templates-dir`) → packaged templates.

## ⚙️ Configuration

Optional `.aidiff.json` at your repo root (JSON5 — comments and trailing commas allowed):

```json5
{
  target: 'main', // default target branch
  exclude: ['**/*.lock', '**/dist/**', '**/*.min.*'], // globs dropped from every diff (these are the defaults)
  template: 'my-template', // default template (name or path)
  templatesDir: './templates', // where named templates live
  budget: 200000, // token budget per prompt (or profile: 'generic-large')
  lineNumbers: true, // annotate diff lines with new-file line numbers
  contextLines: 5, // git diff -U<n>
  functionContext: false, // include whole enclosing functions
  concurrency: 3, // parallel reviewer passes in consensus runs
  runners: {
    // custom AI runners for --run (see "Run the AI" above)
  },
  personas: {
    // extra reviewer personas, or overrides of built-in slugs
    concurrency: 'Focus exclusively on race conditions, locking, and async ordering.',
  },
  github: { command: 'gh' }, // CLI used by post / review --pr
  gitlab: { command: 'glab' }, // CLI used by post
}
```

Additional per-file exclusions go in `.aidiffignore` (minimatch, one pattern per line):

```
**/*.snap
**/generated/**
```

Lockfiles, `dist/` output, and minified files are excluded by default so they don't waste your AI context — set `exclude: []` to disable. The CLI tells you when files were excluded.

## 🗂️ Output

Everything is written to `reviews/` at the repo root by default (override with `--out`). Add `reviews/` to your `.gitignore`. `diff2ai clean` deletes generated artifacts only — your own files in `reviews/` are never touched.

| File              | What it is                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `review_*.md`     | AI-ready prompt (paste into your AI tool)                                                                             |
| `*.response.md`   | AI review output from headless `--run`                                                                                |
| `run_*/`          | Consensus runs: per-persona prompts/responses, `judge.prompt.md`, `consolidated.md`, `comments.md` (`--then comment`) |
| `*.diff`          | Raw unified diff (`diff`/`show`; `review --save-diff`)                                                                |
| `batch_*.md`      | Chunked prompts for large diffs                                                                                       |
| `review_index.md` | Instructions for merging batch results                                                                                |

## 🛡️ Safety

- Never modifies your repo unless you pass `--switch` (and even then refuses over dirty/untracked trees or an in-progress merge/rebase without `--yes`). `--pr`/`--mr` fetch into a private `refs/diff2ai/*` namespace and never touch your branches.
- No network calls by diff2ai itself: `--fetch`/`--pr` use your git, `--run` executes the AI CLI _you_ choose with _your_ credentials, and `post` goes through _your_ `gh`/`glab`.
- Headless reviewer passes run read-only or with tools disabled, depending on what the runner supports.
- Diffs and commit messages are treated as untrusted input in every prompt; follow-up chats are told to verify findings, not obey them.
- Your git config can't skew the diff: colors, custom prefixes, and external diff tools are overridden.

## 🧯 Troubleshooting

- **"Template ... not found"** — named templates resolve from `./templates/` (or `--templates-dir`), then packaged ones. Pass a path ending in `.md` to load a file directly.
- **"Missing required placeholder {diff_content}"** — add `{diff_content}` to your custom template where the diff should be injected.
- **"Target ... not found"** — run `git fetch origin <branch>` first, or pass an existing branch via `--target`.
- **"Runner ... not found on PATH"** — install the CLI (`diff2ai doctor` shows what's installed) or point `runners.<name>.command` at it.
- **Inline comments fell back to one PR comment** — GitHub rejects a review when a comment points outside the PR diff; make sure the review was generated against the PR's base branch.
- **Clipboard copy failed** — on headless Linux install `xsel`/`xclip`; with `--copy` alone diff2ai writes the prompt to a file instead so nothing is lost.

## 🤝 Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, project layout, and guidelines. Good first areas: new templates, runner presets, chunking heuristics, CLI UX.

```bash
npm install && npm test && npm run lint && npm run typecheck
```

## 🪪 License

[MIT](LICENSE) © Nurettin Coban

# diff2ai

[![CI](https://github.com/nurettincoban/diff2ai/actions/workflows/ci.yml/badge.svg)](https://github.com/nurettincoban/diff2ai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/diff2ai.svg?logo=npm&label=npm)](https://www.npmjs.com/package/diff2ai)
[![npm downloads](https://img.shields.io/npm/dm/diff2ai.svg?color=blue)](https://www.npmjs.com/package/diff2ai)
![node version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Turn your Git diffs into high-signal AI code reviews — fast, local, and repo-safe.

- 🤖 **Runs your AI for you**: `--run claude` opens a Claude chat already loaded with the review prompt
- 🧑‍⚖️ **Multi-reviewer consensus**: `--iterations 5` runs five reviewer personas + a judge that validates every finding against the diff
- ⚡️ **Local-first** — pure git; nothing leaves your machine unless _you_ run an AI
- 🧠 **Strict default template** that forces actionable feedback (severity, file/line ranges, proposed fix) instead of AI rambling
- 🧩 **Smart chunking** for diffs that exceed your model's context budget, with merge guidance
- 🎯 **6 packaged templates**: `default`, `basic`, `security`, `api-best-practices`, `reliability`, `event-driven` — plus your own
- 🛡️ **Safety preflight**: refuses to switch branches over dirty trees or mid-merge repos

Quick links: [Install](#-installation) • [Quickstart](#-quickstart) • [Run the AI](#-run-the-ai-directly---run) • [Consensus reviews](#%EF%B8%8F-multi-reviewer-consensus---iterations) • [Commands](#-commands) • [Templates](#-templates) • [Configuration](#%EF%B8%8F-configuration)

---

## ✨ Why diff2ai?

Pasting a raw diff into a chat window gets you noisy, unstructured feedback. diff2ai generates a focused prompt from your actual diff with a strict output schema, so the review you get back has severities, exact file/line references, and concrete fixes — ready to act on. It works with any AI tool you already use: Claude, Cursor, Copilot, ChatGPT, or a local model.

## 📦 Installation

Requires Node.js >= 18.

```bash
npm i -g diff2ai        # global install (recommended)
diff2ai --version

npx diff2ai --help      # or run without installing
```

## 🚀 Quickstart

```bash
# One command: diff your branch vs main and open a Claude chat reviewing it
diff2ai review feature/my-branch --target main --run claude

# Serious mode: 5 independent reviewer personas + a validating judge
diff2ai review feature/my-branch --target main --run claude --iterations 5

# Classic mode: just generate the prompt and copy it for any AI tool
diff2ai review feature/my-branch --target main --copy
```

## 🤖 Run the AI directly (`--run`)

`--run claude` hands the generated prompt straight to the [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code):

- **In a terminal (TTY)** it launches an interactive `claude` chat seeded with the review prompt — you land directly in a session that's already reviewing your diff.
- **In scripts/CI (non-TTY)** it runs headlessly (`claude -p`) and saves the structured review next to the prompt as `*.response.md`.

Any AI CLI works — define your own runners in `.aidiff.json`:

```json5
{
  runners: {
    mytool: {
      command: 'mytool',
      args: ['--model', 'fast'], // always prepended
      headless: { args: ['--pipe'], input: 'stdin' }, // or input: 'promptFileArg'
      interactive: { args: ['{promptFileInstruction}'] },
      timeoutMs: 600000,
    },
  },
}
```

## 🧑‍⚖️ Multi-reviewer consensus (`--iterations`)

One AI review can hallucinate or miss things. `--iterations 5` runs **five independent reviewer passes**, each with a different persona, then a **judge pass** that cross-checks everything:

```bash
diff2ai review feature/payments --run claude --iterations 5
```

1. **You pick the reviewers.** In a terminal, a multi-select opens with the personas — not every change needs a security deep-dive. Script it with `--personas correctness,performance`.

   | Persona (slug)                                         | Focus                                           |
   | ------------------------------------------------------ | ----------------------------------------------- |
   | Bug Hunter (`correctness`)                             | logic errors, edge cases, broken error handling |
   | Security Auditor (`security`)                          | injection, authz/authn, secrets, unsafe input   |
   | Performance Engineer (`performance`)                   | complexity, N+1, leaks, blocking I/O            |
   | API & Maintainability Reviewer (`api-maintainability`) | interfaces, breaking changes, coupling          |
   | Test Engineer (`testing-edge-cases`)                   | missing coverage, brittle tests, boundaries     |

   Add your own (or override a built-in) under `personas` in `.aidiff.json`.

2. **You approve the cost first.** Before any AI call, diff2ai prints the estimated input tokens and number of calls (based on your actual diff) and asks to proceed (`--yes` skips).
3. Each selected persona reviews the same diff in isolation, with a live elapsed-time indicator per pass and artifacts appearing under `reviews/run_*/` as each one finishes.
4. The judge receives the raw diff (ground truth) plus all reviews and must **validate every finding against the diff** — findings referencing files or code not in the diff are discarded — then deduplicate and score consensus.
5. You get one consolidated review where every issue carries a `Consensus: k/N reviewers` line, sorted by severity and agreement. Then you choose (or preset with `--then`): **fix** — a chat opens to verify findings against the codebase and apply fixes; **comment** — a chat drafts ready-to-paste MR/PR review comments into `comments.md` without touching code (handy when reviewing someone else's MR); **none** — just keep the files.

All artifacts are kept under `reviews/run_<timestamp>/` (per-persona prompts and responses, `judge.prompt.md`, `consolidated.md`, and `comments.md` in comment mode), so you can audit exactly what each reviewer said or re-run the judge by hand. If a pass fails, the run continues as long as at least two reviewers succeeded (the consolidated review notes who dropped out).

**Cost & duration, honestly:** every reviewer is a full model invocation over your whole diff, run sequentially, plus the judge — a 5-persona run on a mid-sized diff takes tens of minutes and a meaningful chunk of a subscription rate window. That's why the estimate + confirmation exists. To spend less: pick fewer/targeted personas (3 is usually the sweet spot), tighten `exclude` patterns so noise files never reach the AI, or use plain `--run` without iterations for everyday changes and save consensus mode for risky MRs.

## 🧰 Commands

### `review <ref>` — end to end

Diffs `<ref>` against the target branch (three-dot: `target...ref`) and renders an AI prompt in one step.

```bash
diff2ai review feature/payments                  # writes reviews/review_<timestamp>.md
diff2ai review feature/payments --copy           # clipboard only, no file
diff2ai review feature/payments --save-diff      # also keep the raw .diff
diff2ai review feature/payments --template security
```

| Flag                      | Effect                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `--target <branch>`       | Target branch (default: `main`, or `target` from `.aidiff.json`)                                                  |
| `--template <name\|path>` | Template name (project or packaged) or a direct `.md` path                                                        |
| `--templates-dir <dir>`   | Where to resolve named templates (default: `./templates`)                                                         |
| `--profile <name>`        | Token budget profile; larger diffs are auto-split into batches                                                    |
| `--copy`                  | Copy the prompt to the clipboard instead of writing a file (falls back to a file if the clipboard is unavailable) |
| `--save-diff`             | Also write the raw `.diff`                                                                                        |
| `--out <dir>`             | Output directory (default: `reviews/`)                                                                            |
| `--switch`                | Switch to `<ref>` first; refuses if dirty/untracked/mid-merge unless `--yes`                                      |
| `--fetch`                 | `git fetch origin <target>` and `<ref>` first                                                                     |
| `--run <runner>`          | Execute the review with an AI runner (`claude` built in; custom runners via config)                               |
| `--iterations <n>`        | Multi-reviewer consensus mode: n persona passes + validating judge (requires `--run`, n ≥ 2)                      |
| `--personas <slugs>`      | Exact reviewer personas for the consensus run (e.g. `correctness,security`); skips the interactive picker         |
| `--then <action>`         | After consensus: `fix` (apply-fixes chat), `comment` (draft MR/PR comments, no code changes), `none`              |

If the diff exceeds the profile's token budget, diff2ai automatically writes `batch_*.md` files plus a `review_index.md` with merge instructions (with `--copy`, batch 1 goes to the clipboard). `--run` needs the whole diff in one prompt, so oversized diffs are refused with a hint to use `--profile claude-large`.

### The rest

```bash
diff2ai post <review.md>       # post findings to a GitLab MR via glab (see below)
diff2ai diff                   # working tree vs target → reviews/diff_<timestamp>.diff
diff2ai diff --staged          # staged changes → reviews/staged_<timestamp>.diff
diff2ai show <sha>             # one commit → reviews/commit_<sha>_<timestamp>.diff
diff2ai prompt <file.diff>     # render a prompt from an existing diff (--template, --out)
diff2ai chunk <file.diff>      # split a big diff into batch_*.md + review_index.md (--profile)
diff2ai templates              # list project + packaged templates
diff2ai doctor                 # diagnose repo state (dirty tree, divergence, stale fetch...)
```

Global flags: `--no-interactive` (disable prompts, for CI/non-TTY) and `--yes` (auto-confirm safe prompts).

### `post <review.md>` — comment on a GitLab MR

Turns a diff2ai review (a consensus `consolidated.md`, a headless `*.response.md`, or anything in the issue-block schema) into one well-formatted MR comment — severity badges, consensus scores, collapsible findings with proposed fixes — and posts it through **your authenticated [`glab`](https://gitlab.com/gitlab-org/cli) CLI**. diff2ai itself still makes zero network calls.

```bash
diff2ai post reviews/run_*/consolidated.md --dry-run        # preview the comment
diff2ai post reviews/run_*/consolidated.md                  # post to the current branch's MR (asks first)
diff2ai post consolidated.md --mr 123 --min-severity HIGH   # specific MR, drop LOW/INFO noise
```

| Flag                   | Effect                                                     |
| ---------------------- | ---------------------------------------------------------- |
| `--mr <iid>`           | Target MR IID or branch (default: the current branch's MR) |
| `--min-severity <sev>` | Only post findings at or above this severity               |
| `--dry-run`            | Print the comment instead of posting                       |

Posting always requires consent: interactive mode asks, non-interactive mode requires an explicit `--yes`. The full GitLab flow, end to end:

```bash
git fetch origin main
diff2ai review feature/mr-branch --target main --run claude --iterations 3 --then none --yes
diff2ai post reviews/run_*/consolidated.md --mr 123 --min-severity MEDIUM --yes
```

## 🧱 Templates

Packaged templates (use by name, no copying needed):

| Template             | Focus                                                        |
| -------------------- | ------------------------------------------------------------ |
| `default`            | Strict, structured general review (recommended)              |
| `basic`              | Lightweight, minimal instructions                            |
| `security`           | Injection, authz/authn, secrets, unsafe deserialization      |
| `api-best-practices` | REST/HTTP semantics, versioning, error contracts             |
| `reliability`        | Error handling, retries, timeouts, resource leaks            |
| `event-driven`       | Message contracts, idempotency, ordering, delivery semantics |

The default template enforces numbered issue blocks — no preamble, no diff echo:

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

### Custom templates

Any `.md` file containing the `{diff_content}` placeholder works:

```bash
diff2ai review feature/api --template my-template          # resolves ./templates/my-template.md
diff2ai review feature/api --template ./docs/review.md     # or a direct path
diff2ai review feature/api --templates-dir ./my-templates --template code-review
```

Resolution order: direct path → project `templates/` (or `--templates-dir`) → packaged templates.

## ⚙️ Configuration

Optional `.aidiff.json` in your repo root (JSON5 — comments and trailing commas allowed):

```json5
{
  target: 'main', // default target branch
  profile: 'generic-medium', // default chunking profile
  exclude: ['**/*.lock', '**/dist/**', '**/*.min.*'], // globs dropped from every diff (these are the defaults)
  template: 'my-template', // default template (name or path)
  templatesDir: './templates', // where named templates live
  runners: {
    // custom AI runners for --run (see "Run the AI directly" above)
  },
  personas: {
    // extra reviewer personas for --iterations, or overrides of built-in slugs
    concurrency: 'Focus exclusively on race conditions, locking, and async ordering.',
  },
}
```

Additional per-file exclusions go in `.aidiffignore` (minimatch, one pattern per line):

```
**/*.snap
**/generated/**
```

Lockfiles, `dist/` output, and minified files are excluded by default so they don't waste your AI context — pass `exclude: []` to disable. The CLI tells you when files were excluded.

Chunking profiles (approximate token budgets): `claude-large` ≈ 150k • `generic-large` ≈ 100k • `generic-medium` ≈ 30k (default).

## 🗂️ Output

Everything is written to `reviews/` by default (override with `--out`). Add `reviews/` to your `.gitignore`.

| File              | What it is                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `review_*.md`     | AI-ready prompt (paste into your AI tool)                                                                                  |
| `*.response.md`   | AI review output from headless `--run`                                                                                     |
| `run_*/`          | Multi-reviewer runs: per-persona prompts/responses, `judge.prompt.md`, `consolidated.md`, `comments.md` (`--then comment`) |
| `*.diff`          | Raw unified diff (`diff`/`show`; `review --save-diff`)                                                                     |
| `batch_*.md`      | Chunked prompts for large diffs                                                                                            |
| `review_index.md` | Instructions for merging batch results                                                                                     |

## 🛡️ Safety

- Never modifies your repo unless you pass `--switch` (and even then refuses over dirty/untracked trees or an in-progress merge/rebase without `--yes`).
- No network calls by diff2ai itself — `--fetch` is opt-in git, and `--run` executes the AI CLI _you_ choose with _your_ credentials.
- Reviewer passes run with tools disabled: the AI sees exactly the prompt (template + diff), nothing else.

## 🧯 Troubleshooting

- **"Template ... not found"** — named templates resolve from `./templates/` (or `--templates-dir`), then packaged ones. Pass a path ending in `.md` to load a file directly.
- **"Missing required placeholder {diff_content}"** — add `{diff_content}` to your custom template where the diff should be injected.
- **"Target ... not found"** — run `git fetch origin <branch>` first, or pass an existing branch via `--target`.
- **`chunk` produced one file** — your diff fits the profile budget; that's expected.
- **Clipboard copy failed** — on headless Linux install `xsel`/`xclip`; with `--copy` alone diff2ai writes the prompt to a file instead so nothing is lost.

## 🤝 Contributing

PRs welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, project layout, and guidelines. Good first areas: new templates, chunking heuristics, CLI UX.

```bash
npm install && npm test && npm run lint && npm run typecheck
```

## 🪪 License

[MIT](LICENSE) © Nurettin Coban

# diff2ai

[![npm version](https://img.shields.io/npm/v/diff2ai.svg?logo=npm&label=npm)](https://www.npmjs.com/package/diff2ai)
[![npm downloads](https://img.shields.io/npm/dm/diff2ai.svg?color=blue)](https://www.npmjs.com/package/diff2ai)
![node version](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#license) [![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](#)

> ⭐️ If you find diff2ai useful, please give it a star on GitHub — it helps a lot!

Quick links: [Installation](#installation) • [Quickstart](#quickstart) • [CLI](#cli-at-a-glance) • [Demos](#demos) • [Configuration](#configuration)

Turn your Git diffs into beautiful, high-signal AI code review prompts — fast, local, and repo-safe.

- ⚡️ Zero network by default (pure git)
- 🧠 Strict, opinionated default template that drives high‑quality AI feedback
- 🧩 Smart chunking for large diffs with merge guidance
- 🛡️ Safety preflight checks; no destructive actions without consent
- 🖼️ Pretty CLI output in TTY; stays script‑friendly for CI

---

## ✨ Why diff2ai?

Most AI reviews are noisy. diff2ai generates a focused prompt from your actual diff, with a strict schema that forces actionable feedback (severity, file/line ranges, proposed fix). Paste it into your favorite AI coding agent and get a concise, useful review.

---

## 📦 Installation

Requirements

- Node.js >= 18

Global install (recommended)

```bash
npm i -g diff2ai
diff2ai --version   # verify (e.g., 0.0.3)
```

Use without installing (npx)

```bash
npx diff2ai --help
```

Upgrade to latest

```bash
npm i -g diff2ai@latest
```

## 🚀 Quickstart

```bash
# Generate AI-ready prompt for your MR against main
git fetch origin main
diff2ai review feature/my-branch --target main --copy

# Optional: let diff2ai switch to the branch for you (repo will remain on it)
diff2ai review feature/my-branch --target main --copy --switch --fetch

# Paste the generated prompt from your clipboard into Claude, Cursor, or Copilot
```

---

## 🧰 CLI at a glance

- `review <ref>`: end‑to‑end — generate a diff from a branch/ref and immediately produce an AI prompt (default template). Add `--copy` to place the prompt on your clipboard. Use `--save-diff` if you also want the raw `.diff` file written.
  - Flags:
    - `--switch` Switch to `<ref>` before running (refuses if dirty/untracked unless `--yes`)
    - `--fetch` Fetch `origin/<target>` and `origin/<ref>` before running
- `prompt <diff>`: render an AI prompt from an existing `.diff` file.
  - Flags:
    - `--template <nameOrPath>` Use a template by name (from project `./templates/`) or a direct `.md` file path (absolute or relative)
    - `--templates-dir <dir>` Directory to resolve named templates from (defaults to project `./templates/`)
- `diff [--staged]`: write a `.diff` from your working tree (or staged changes).
- `show <sha>`: write a `.diff` for a specific commit.
- `chunk <diff>`: split a large `.diff` into `batch_*.md` files + index.

Global flags (MVP):

- `--no-interactive` Disable prompts (for CI/non‑TTY)
- `--yes` Auto‑confirm safe prompts

---

## 🎬 Demos

<details>
<summary>Show demos</summary>

Review a branch (auto‑prompt + copy to clipboard):

```bash
diff2ai review feature/payments --copy
# writes:
#  - review_YYYY-MM-DD_HH-mm-ss-SSS.md  (default template)
#  - copies prompt content to your clipboard
#  - add --save-diff to also write review_YYYY-MM-DD_HH-mm-ss-SSS.diff
# Recommended for AI agents (Cursor/Claude):
# Ensure the tool is on the branch being reviewed and fetch refs
diff2ai review feature/payments --target main --copy --switch --fetch
```

Pick a template explicitly:

```bash
diff2ai review feature/api --template default
# or a minimal one
diff2ai review feature/api --template basic
# or your own project template (./templates/my-template.md)
diff2ai review feature/api --template my-template
# or via direct file path
diff2ai review feature/api --template ./templates/my-template.md
# specify a custom templates directory
diff2ai review feature/api --templates-dir ./my-templates --template code-review
```

Work from an existing diff:

```bash
diff2ai diff --staged         # produce staged_*.diff
diff2ai prompt staged_*.diff  # produce staged_*.md (uses default template)
# with a custom template
diff2ai prompt staged_*.diff --template my-template
# To save the AI response yourself, use native OS commands, e.g. on macOS:
# pbpaste > reviews/review_response.md
```

Handle big diffs:

```bash
diff2ai chunk huge.diff --profile generic-medium
# writes batch_*.md and review_index.md (merge instructions included)
```

 </details>

---

## 🧱 The default template (strict)

The default template enforces a clean, repeatable review structure. AI reviewers must output only numbered issue blocks — no preambles, no conclusions, no diff echo.

Issue block schema:

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

For chunked reviews: “Do not assume context outside this chunk; if cross‑file risks are suspected, note briefly.”

Templates available:

- `default` (strict, recommended)
- `basic` (lightweight)

## 🧪 Example output

```text
## 1) Severity: HIGH | Type: Implementation
Title: Avoid mutation of request body in middleware

Affected:
- src/middleware/auth.ts:42-57

Explanation:
Mutating the incoming request object can introduce side effects across downstream handlers. Use a cloned object or limit changes to a derived value.

Proposed fix:
~~~ts
const sanitized = { ...req.body, password: undefined };
next();
~~~
```

---

## 🗂️ Output files

- Default output location: current working directory.
- Recommended: use a dedicated `reviews/` directory and add it to `.gitignore`.

- `*.md` AI‑ready prompt (paste into your AI coding agent)
- `*.diff` unified diff (optional for `review` via `--save-diff`; always produced by `diff`/`show`)
- `batch_*.md` chunked prompts for large diffs
- `review_index.md` guidance for merging batch results into a single review

```bash
diff2ai review feature/api --target main --save-diff
# writes reviews/*.md and reviews/*.diff (with --save-diff)
```

Paste the generated `*.md` into the MR/PR description or as a top comment.
Use the prompt with your AI reviewer. Save the AI’s response locally with `diff2ai pasteback` and commit or share as needed.

---

## 🛡️ Safety & behavior

- Preflight checks warn about dirty/untracked files, stash, and divergence.
- Interactive prompts guide target selection; non‑interactive mode stays quiet.
- No destructive actions are taken without explicit confirmation.
- `--switch` will refuse to change branches if the working tree is dirty or has untracked files unless you pass `--yes`. The repository remains on `<ref>` after completion.

---

## ⚙️ Configuration

Create `.aidiff.json` (JSON5 supported):

```json5
{
  target: 'main', // default target branch
  profile: 'generic-medium', // default chunking profile
  include: ['src/**', 'apps/**'],
  exclude: ['**/*.lock', 'dist/**', '**/*.min.*'],
  // Optional: default template config
  // Use a name (resolved from project ./templates by default) or a file path
  template: 'my-template',
  // Optional: where to resolve named templates from (defaults to ./templates)
  templatesDir: './templates',
}
```

Ignore paths in `.aidiffignore` (minimatch):

```
**/*.lock
**/dist/**
**/*.min.*
```

Profiles (token budgets):

- `claude-large` ≈ 150k tokens
- `generic-large` ≈ 100k tokens
- `generic-medium` ≈ 30k tokens

---

## 🧯 Troubleshooting

- Templates directory not found
  - Fixed in >= 0.0.2. Update to latest: `npm i -g diff2ai@latest`.
  - If developing locally, ensure `npm run build` copied `templates/` into `dist/templates/`.
  - Project-local `templates/` in your CWD are also supported.

- Custom template not found
  - When using a name (e.g., `--template my-template`), diff2ai looks for `./templates/my-template.md` by default, or under `--templates-dir`/`templatesDir` if provided.
  - You can also pass a direct path: `--template ./my-templates/review.md`.

- "Missing required placeholder {diff_content}"
  - Your custom template must include `{diff_content}` where you want the unified diff injected.

---

## 🤝 Contributing

We welcome contributions! Ways to help:

- Improve templates and review schema
- Enhance chunking heuristics and performance
- Add tests and fixtures for edge cases
- Polish CLI UX and docs

Dev setup:

```bash
npm install
npm run build
npm test
npm run lint
npm run format
```

Conventional flow:

1. Fork & branch (small, focused changes)
2. Add tests when adding features/fixing bugs
3. Keep files < 300 lines where practical
4. Ensure `npm test` and `npm run lint` pass
5. Open a PR with a clear description and screenshots/terminal output when relevant

---

## ❓ FAQ

- “Why did `chunk` produce only one file?”
  - Your diff likely fits within the selected profile’s token budget; that’s expected.
- “Where do I put the AI’s response?”
  - Wherever you prefer: PR comments, a `review.md` file, or your internal tools.
- “Can I script this in CI?”
  - Yes. Use `--no-interactive` (and `--yes` if needed).

- “Does this upload my code anywhere?”
  - No. It runs 100% locally and writes to your filesystem. You decide what to paste into an AI.
- “How do I handle huge MRs?”
  - Use `diff2ai chunk <diff> --profile <name>`, paste each `batch_*.md` to your AI, then merge the results guided by `review_index.md`.
- “Can I use this on GitLab MRs?”
  - Yes. Checkout the MR branch locally (or fetch the refs), then run `diff2ai review <branch> --target <base>`.

---

## 🪪 License

MIT

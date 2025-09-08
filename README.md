# diff2ai

MVP — under active development. Made with ❤️ in Finland.

Turn your Git diffs into beautiful, high-signal AI code review prompts — fast, local, and repo-safe.

- ⚡️ Zero network by default (pure git)
- 🧠 Strict, opinionated default template that drives high‑quality AI feedback
- 🧩 Smart chunking for large diffs with merge guidance
- 🛡️ Safety preflight checks; no destructive actions without consent
- 🖼️ Pretty CLI output in TTY; stays script‑friendly for CI

---

## Why diff2ai?
Most AI reviews are noisy. diff2ai generates a focused prompt from your actual diff, with a strict schema that forces actionable feedback (severity, file/line ranges, proposed fix). Paste it into your favorite AI coding agent and get a concise, useful review.

### 10-second Quickstart
```bash
# Generate AI-ready prompt for your MR against main
git fetch origin main
diff2ai review feature/my-branch --target main

# Paste the generated *.md file into Claude, Cursor, or Copilot
```

---

## Quickstart

Local usage (dev):
```bash
npm install
npm run build
node dist/cli.js --help
```

Global usage (link):
```bash
npm run build
npm link
# Now available everywhere
diff2ai --help
```

---

## CLI at a glance

- `review <ref>`: end‑to‑end — generate a diff from a branch/ref and immediately produce an AI prompt (default template).
- `prompt <diff>`: render an AI prompt from an existing `.diff` file.
- `diff [--staged]`: write a `.diff` from your working tree (or staged changes).
- `show <sha>`: write a `.diff` for a specific commit.
- `chunk <diff>`: split a large `.diff` into `batch_*.md` files + index.
- `doctor`: diagnose repo state (dirty, behind/ahead, last fetch, etc.).

Global flags (MVP):
- `--no-interactive` Disable prompts (for CI/non‑TTY)
- `--yes` Auto‑confirm safe prompts

---

## Demos

Review a branch (auto‑prompt):
```bash
diff2ai review feature/payments
# writes:
#  - review_YYYY-MM-DD_HH-mm-ss-SSS.diff
#  - review_YYYY-MM-DD_HH-mm-ss-SSS.md  (default template)
```

Pick a template explicitly:
```bash
diff2ai review feature/api --template default
# or a minimal one
diff2ai review feature/api --template basic
```

Work from an existing diff:
```bash
diff2ai diff --staged         # produce staged_*.diff
diff2ai prompt staged_*.diff  # produce staged_*.md
```

Handle big diffs:
```bash
diff2ai chunk huge.diff --profile generic-medium
# writes batch_*.md and review_index.md (merge instructions included)
```

---

## The default template (strict)
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

## Example output
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

## Output files
- Default output location: current working directory.
- Recommended: use a dedicated `reviews/` directory and add it to `.gitignore`.

- `*.diff` unified diff (input for prompt rendering and chunking)
- `*.md` AI‑ready prompt (paste into your AI coding agent)
- `batch_*.md` chunked prompts for large diffs
- `review_index.md` guidance for merging batch results into a single review

```bash
diff2ai review feature/api --target main
# writes reviews/*.diff and reviews/*.md by default
```

Paste the generated `*.md` into the MR/PR description or as a top comment.
Use the prompt with your AI reviewer. Save the AI’s response wherever you prefer — PR comments, a `review.md` file, or your internal tooling.

---

## Safety & behavior
- Preflight checks warn about dirty/untracked files, stash, and divergence.
- Interactive prompts guide target selection; non‑interactive mode stays quiet.
- No destructive actions are taken without explicit confirmation.

---

## Configuration
Create `.aidiff.json` (JSON5 supported):
```json5
{
  "target": "main",                 // default target branch
  "profile": "generic-medium",      // default chunking profile
  "include": ["src/**", "apps/**"],
  "exclude": ["**/*.lock", "dist/**", "**/*.min.*"]
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

## Contributing
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

## FAQ
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

## License
MIT

# diff2ai

CLI tool that extracts Git diffs from MRs/PRs and formats them for AI code review without requiring repository access.

## Quickstart (Local Development)

```bash
# Install deps
npm install

# Build
npm run build

# See help
node dist/cli.js --help
```

## Usage

- `diff` – Generate diffs against target branch or staged changes
```bash
# Working tree vs target (default target: main)
node dist/cli.js diff

# Staged changes only
node dist/cli.js diff --staged
```

- `show` – Commit-by-commit review
```bash
node dist/cli.js show <sha>
```

- `mr` – Fetch & diff an MR/PR
```bash
# GitHub PR
node dist/cli.js mr --id 123 --platform github --target main

# GitLab MR
node dist/cli.js mr --id 123 --platform gitlab --target main
```

- `prompt` – Generate AI-ready markdown from a diff file
```bash
node dist/cli.js prompt path/to.diff --template comprehensive
# templates: basic | comprehensive | security
```

- `chunk` – Split large diffs into batches
```bash
node dist/cli.js chunk path/to.diff --profile generic-medium
# profiles: claude-large | generic-large | generic-medium
```

### Output Files
- `*.diff`: Raw unified diff output
- `*.md`: AI-ready prompt using the selected template
- `batch_*.md`: Chunked review files for large diffs
- `review_index.md`: Index linking all batch files

## Configuration

Create `.aidiff.json` in your repository root (JSON5 supported):
```json5
{
  "target": "main",
  "profile": "generic-large",
  "include": ["src/**", "apps/**"],
  "exclude": ["**/*.lock", "dist/**", "**/*.min.*"]
}
```

Ignore patterns with `.aidiffignore` (minimatch syntax):
```
# example
**/*.lock
**/dist/**
**/*.min.*
```

Notes
- Missing config falls back to defaults with a warning.
- Ignore patterns are applied when processing paths from diffs.

## Error Handling (What you’ll see)

- Missing Git repo
```
Error: Missing Git repo. Ensure a .git directory exists.
```

- Invalid diff target
```
Error: Invalid diff target. Available remote branches:
  origin/main
  origin/develop
  ...
```

- MR/PR fetch failure (GitHub example)
```
Error: Could not fetch PR #123
Try manually: git fetch origin pull/123/head:pr-123 && git checkout pr-123
```

- Missing diff file for prompt/chunk
```
Diff file not found: <path>
```

## Performance
- Goal: process <1000 LOC diffs in <2 seconds on a typical dev machine.
- Use `chunk` when diffs exceed model/profile token budgets.

## Templates
- Files in `templates/`: `basic.md`, `comprehensive.md`, `security.md`
- If templates are missing, a built-in comprehensive template is used.

## Development

- Scripts
```bash
npm run build     # bundle CLI into dist/
npm run lint      # ESLint (flat config)
npm run format    # Prettier
npm test          # build + Vitest
```

- Tech Stack
  - TypeScript, Node.js 18+
  - Bundler: tsup
  - CLI: commander
  - Git ops: simple-git
  - Config: json5
  - Ignore: minimatch

## Roadmap (MVP parity)
- [x] diff / diff --staged
- [x] show <sha>
- [x] mr --id with GitHub/GitLab fetch refs
- [x] prompt with templates
- [x] chunk with profiles and index
- [ ] Additional tests and performance checks
- [ ] README examples for Windows shells

## License
MIT

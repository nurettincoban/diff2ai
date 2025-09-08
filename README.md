# diff2ai

CLI tool that extracts Git diffs from branches/refs and formats them for AI code review without requiring repository access.

## Quickstart (Local Development)

```bash
npm install
npm run build
node dist/cli.js --help
```

## Minimal Flags (MVP)
- `--no-interactive`: disable prompts (for CI/non-TTY)
- `--yes`: auto-confirm safe prompts

Interactive mode is on by default when attached to a TTY.

## Workflow
1) Generate a diff and an AI prompt automatically:
```bash
node dist/cli.js review feature/branch        # writes review_*.diff and review_*.md (default template)
```
2) Paste the AI's response into `review.md` in your repo.

- For large diffs:
```bash
node dist/cli.js chunk path/to.diff --profile generic-medium
# Produces batch_*.md and review_index.md with merge guidance
```
Process each batch with your AI, then merge issue blocks into a single `review.md` (no duplicates).

## Usage

- review – High-level flow (auto-prompt)
```bash
node dist/cli.js review feature/login                 # default template
node dist/cli.js review feature/api --target main     # choose target branch
node dist/cli.js review feature/api --template basic  # basic template
```

- diff – Generate diffs
```bash
node dist/cli.js diff
node dist/cli.js diff --staged
```

- prompt – Generate a prompt from a diff file
```bash
node dist/cli.js prompt path/to.diff --template default
```

## Templates
- `templates/default.md`: strict schema with Severity/Type/Title/Affected/Explanation/Proposed fix
- `templates/basic.md`: minimal guidance

## Error Handling
- Missing Git repo: clear message
- Invalid diff target: shows available remote branches
- Missing files: concise errors with next steps

## Performance
- Goal: process <1000 LOC diffs in <2 seconds on a typical dev machine
- Use `chunk` when diffs exceed model/profile token budgets

## Development
```bash
npm run build
npm run lint
npm run format
npm test
```

## Roadmap (MVP parity)
- [x] review (pure git, refs/branches)
- [x] diff / diff --staged
- [x] show <sha>
- [x] prompt with templates (basic, default)
- [x] chunk with profiles and index
- [x] interactive prompts and safety checks
- [ ] tests for interactive flows
- [ ] performance check (<1000 LOC in <2s)

## License
MIT

# diff2ai - Technical Specification

## Core Purpose

CLI tool that extracts Git diffs from MRs/PRs and formats them for AI code review without requiring repository access.

## MVP Features (v1.0)

### 1. Git Operations

- Fetch MRs/PRs using standard git refs:
  - GitHub: `git fetch origin pull/123/head:pr-123`
  - GitLab: `git fetch origin merge-requests/123/head:mr-123`
- Generate diffs: `git diff origin/main...HEAD`
- Support staged changes: `git diff --staged`
- Commit-by-commit review: `git show -p <sha>`

### 2. CLI Commands

```bash
diff2ai mr --id 123 --target main        # Fetch and diff MR/PR (default: main)
diff2ai diff --staged                    # Review staged changes
diff2ai prompt mr_123.diff --template    # Generate AI prompt
diff2ai chunk --profile generic-medium   # Handle large diffs
```

### 3. Output Formats

- `*.diff` - Raw unified diff
- `*.md` - AI-ready prompt with instructions asking AI to add review comments directly above changed lines
- `*_reviewed.diff` - Diff file with AI comments inserted as inline comments

### 4. Large Diff Handling

- `.aidiffignore` file support
- Model profiles with token budgets:
  - `claude-large`: 150k tokens
  - `generic-large`: 100k tokens
  - `generic-medium`: 30k tokens
- Smart chunking strategy:
  - Keep related changes together (same file if possible)
  - 20-line context overlap between chunks for continuity
  - Preserve full function/class boundaries when splitting
  - Generate `batch_*.md` files with self-contained context
- Index file (`review_index.md`) linking all batches

### 5. Configuration

`.aidiff.json`:

```json
{
  "target": "main",
  "profile": "generic-large",
  "include": ["src/**", "apps/**"],
  "exclude": ["**/*.lock", "dist/**", "**/*.min.*"]
}
```

## Technical Stack

- **Language**: TypeScript/Node.js
- **Runtime**: Node.js 18+
- **Dependencies**:
  - `simple-git` - Git operations
  - `commander` - CLI framework
  - `chalk` - Terminal colors
  - `minimatch` - Glob pattern matching for .aidiffignore
  - `json5` - Config file parsing
  - `ora` - Spinner for long operations
- **Dev Dependencies**:
  - `typescript` - Type safety
  - `@types/node` - Node.js types
  - `vitest` - Testing framework
  - `tsx` - TypeScript execution
  - `eslint` - Linting
  - `prettier` - Code formatting
- **Package**: npm (`npx diff2ai`)
- **Build**: `tsup` for bundling

## File Structure

```
diff2ai/
├── src/
│   ├── cli.ts           # CLI entry point
│   ├── commands/        # Command implementations
│   ├── git/             # Git operations
│   ├── formatters/      # Output formatters
│   └── chunker/         # Diff chunking logic
├── templates/           # Prompt templates
└── package.json
```

## Implementation Requirements

1. Zero network calls by default (local-only)
2. Process large diffs (<1000 LOC) under 2 seconds
3. Cross-platform: Linux, macOS, Windows
4. Minimal dependencies
5. Clear error messages for missing MRs or Git issues

## Error Handling

- **MR/PR fetch failures**: Display manual fetch command for user to run:
  ```
  Error: Could not fetch PR #123
  Try manually: git fetch origin pull/123/head:pr-123 && git checkout pr-123
  ```
- **Missing Git repo**: Check for `.git` directory, provide clear message
- **Invalid diff target**: Suggest available branches with `git branch -r`
- **Large file warnings**: Alert when diff exceeds model limits, auto-chunk
- **Config errors**: Fall back to defaults with warning message

## Built-in Templates

### 1. Basic Template (`--template basic`)

```markdown
Review this diff and add // REVIEW: comments above any lines with issues:

{diff_content}
```

### 2. Comprehensive Template (`--template comprehensive`, default)

````markdown
# Code Review Request

Review the following diff and add comments directly above problematic lines.
Format: // REVIEW: [ERROR|WARNING|INFO] Your comment here

Check for:

- Bugs and logic errors
- Missing tests or test coverage gaps
- Security vulnerabilities
- Performance issues
- Code style and best practices
- Breaking changes to APIs

Example:

```diff
+ function processUser(data) {
+   // REVIEW: ERROR Missing null check - data could be undefined
+   return data.name.toUpperCase();
+ }
```
````

--- START DIFF ---
{diff_content}
--- END DIFF ---

````

### 3. Security Template (`--template security`)
```markdown
# Security Review

Analyze this diff and add security comments above vulnerable lines.
Format: // SECURITY: [CRITICAL|HIGH|MEDIUM|LOW] Description

Focus on:
- SQL injection, XSS, CSRF vulnerabilities
- Exposed secrets or credentials
- Insecure data handling
- Authentication/authorization flaws
- Dependency vulnerabilities

{diff_content}
````

## Review Output Format (MVP)

For MVP, AI agents will be prompted to add inline comments directly in the diff:

```diff
+ function calculateTotal(items) {
+   // REVIEW: ERROR Missing null/undefined check for items parameter
+   // REVIEW: WARNING Consider using reduce() for better performance
+   let total = 0;
+   for (let item of items) {
+     total += item.price;
+   }
+   return total;
+ }
```

The output can be directly pasted back into code editors or used for manual review.

## Not in Scope (v1.0)

- Direct AI API integration
- Auto-posting comments to GitHub/GitLab
- Built-in AI model
- IDE plugins
- Bitbucket/Azure DevOps support

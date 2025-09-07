# AI Diff Reviewer - Technical Specification

## Core Purpose
CLI tool that extracts Git diffs from MRs/PRs and formats them for AI code review without requiring repository access.

## MVP Features (v1.0)

### 1. Git Operations
- Fetch GitHub/GitLab MRs/PRs locally
- Generate diffs: `git diff origin/main...HEAD`
- Support staged changes: `git diff --staged`
- Commit-by-commit review: `git show -p <sha>`

### 2. CLI Commands
```bash
ai-review mr --id 123 --target main        # Fetch and diff MR/PR
ai-review diff --staged                    # Review staged changes
ai-review prompt mr_123.diff --template    # Generate AI prompt
ai-review annotate --from review.json      # Apply inline comments
ai-review chunk --profile generic-medium   # Handle large diffs
```

### 3. Output Formats
- `*.diff` - Raw unified diff
- `*.md` - AI-ready prompt with instructions
- `review.json` - Structured comments with file/line references

### 4. Large Diff Handling
- `.aidiffignore` file support
- Model profiles with token budgets:
  - `claude-large`: 150k tokens
  - `generic-large`: 100k tokens  
  - `generic-medium`: 30k tokens
- Automatic chunking into `batch_*.md` files
- Index file linking all batches

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
- **Package**: npm (`npx ai-diff-review`)
- **Build**: `tsup` for bundling

## File Structure
```
ai-diff-reviewer/
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

## Prompt Template Structure
```markdown
# AI Code Review Request

Review the following diff for:
- Bugs and logic errors
- Missing tests
- Security issues
- Performance concerns

Provide feedback in unified diff format.

--- START DIFF ---
{diff_content}
--- END DIFF ---
```

## Not in Scope (v1.0)
- Direct AI API integration
- Auto-posting comments to GitHub/GitLab
- Built-in AI model
- IDE plugins
- Bitbucket/Azure DevOps support
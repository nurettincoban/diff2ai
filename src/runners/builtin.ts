import type { RunnerConfig } from './types.js';

// Note: no `--bare` — it restricts auth to ANTHROPIC_API_KEY and would break
// OAuth/subscription users. Tools are disabled so reviews are diff-only.
export const BUILTIN_RUNNERS: Record<string, RunnerConfig> = {
  claude: {
    command: 'claude',
    headless: { args: ['-p', '--tools', '', '--no-session-persistence'], input: 'stdin' },
    interactive: { args: ['{promptFileInstruction}'] },
    timeoutMs: 600_000,
  },
};

import type { RunnerConfig } from './types.js';

// For CLIs that take the headless prompt as an argument instead of stdin:
// point them at the prompt file rather than putting a whole diff in argv.
const READ_PROMPT_FILE =
  'Read the file {promptFile}. It contains code review instructions and a diff. Follow those instructions exactly and output only what they ask for.';

// Built-in presets. Headless modes are configured read-only / tool-less where
// the CLI supports it, so a review pass can only produce text. Any entry can
// be overridden (or new ones added) under "runners" in .aidiff.json.
export const BUILTIN_RUNNERS: Record<string, RunnerConfig> = {
  // Note: no `--bare` — it restricts auth to ANTHROPIC_API_KEY and would break
  // OAuth/subscription users. Tools are disabled so reviews are diff-only.
  claude: {
    command: 'claude',
    headless: { args: ['-p', '--tools', '', '--no-session-persistence'], input: 'stdin' },
    interactive: { args: ['{promptFileInstruction}'] },
    timeoutMs: 600_000,
    install: 'npm i -g @anthropic-ai/claude-code (or see https://code.claude.com/docs/en/setup)',
  },
  // `codex exec -` reads the prompt from stdin; only the final message goes to stdout.
  codex: {
    command: 'codex',
    headless: { args: ['exec', '--sandbox', 'read-only', '--ephemeral', '-'], input: 'stdin' },
    interactive: { args: ['{promptFileInstruction}'] },
    install: 'npm i -g @openai/codex',
  },
  // Piped stdin runs non-interactively; write/shell tools are denied headless.
  gemini: {
    command: 'gemini',
    headless: { args: ['--output-format', 'text'], input: 'stdin' },
    interactive: { args: ['-i', '{promptFileInstruction}'] },
    install: 'npm i -g @google/gemini-cli',
  },
  // `run` rejects permission requests; the plan agent cannot edit or run shell.
  opencode: {
    command: 'opencode',
    headless: { args: ['run', '--agent', 'plan'], input: 'stdin' },
    interactive: { args: ['--prompt', '{promptFileInstruction}'] },
    install: 'npm i -g opencode-ai',
  },
  // Cursor CLI (`cursor-agent`, also installed as `agent`); ask mode is read-only.
  cursor: {
    command: 'cursor-agent',
    headless: {
      args: ['-p', '--output-format', 'text', '--mode', 'ask', '--trust', READ_PROMPT_FILE],
      input: 'promptFileArg',
    },
    interactive: { args: ['{promptFileInstruction}'] },
    install: 'curl https://cursor.com/install -fsS | bash',
  },
};

// `ollama:<model>` (e.g. --run ollama:qwen2.5-coder) runs a local model.
// Ollama has no tools and cannot open a chat with a first message, so it is
// headless-only.
export function ollamaRunner(model: string): RunnerConfig {
  return {
    command: 'ollama',
    headless: { args: ['run', model, '--hidethinking', '--nowordwrap'], input: 'stdin' },
    interactive: false,
    timeoutMs: 1_800_000, // local models can be slow on large diffs
    install: 'https://ollama.com/download',
  };
}

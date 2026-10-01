export type RunnerInput = 'stdin' | 'promptFileArg';

// Shape accepted in .aidiff.json under `runners`
export type RunnerConfig = {
  command: string;
  args?: string[]; // always prepended, both modes
  headless?: { args?: string[]; input?: RunnerInput };
  // `false` for tools that cannot open a chat seeded with a first message
  interactive?: { args?: string[] } | false;
  timeoutMs?: number;
  install?: string; // install hint shown when the command is missing (built-ins)
};

export type ResolvedRunner = {
  name: string;
  command: string;
  args: string[];
  headless: { args: string[]; input: RunnerInput };
  interactive: { args: string[] } | null;
  timeoutMs: number;
  install?: string;
};

export type RunnerResult = { ok: true; output: string } | { ok: false; error: string };

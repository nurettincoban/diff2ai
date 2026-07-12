export type RunnerInput = 'stdin' | 'promptFileArg';

// Shape accepted in .aidiff.json under `runners`
export type RunnerConfig = {
  command: string;
  args?: string[]; // always prepended, both modes
  headless?: { args?: string[]; input?: RunnerInput };
  interactive?: { args?: string[] };
  timeoutMs?: number;
};

export type ResolvedRunner = {
  name: string;
  command: string;
  args: string[];
  headless: { args: string[]; input: RunnerInput };
  interactive: { args: string[] };
  timeoutMs: number;
};

export type RunnerResult = { ok: true; output: string } | { ok: false; error: string };

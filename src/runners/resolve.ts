import { BUILTIN_RUNNERS, ollamaRunner } from './builtin.js';
import type { ResolvedRunner, RunnerConfig, RunnerInput } from './types.js';

function mergedRunners(configRunners?: Record<string, RunnerConfig>): Record<string, RunnerConfig> {
  return { ...BUILTIN_RUNNERS, ...(configRunners ?? {}) };
}

export function listRunnerNames(configRunners?: Record<string, RunnerConfig>): string[] {
  return Object.keys(mergedRunners(configRunners)).sort();
}

export function resolveRunner(
  name: string,
  configRunners?: Record<string, RunnerConfig>,
): ResolvedRunner {
  const all = mergedRunners(configRunners);
  let raw = all[name];
  const ollama = /^ollama:(.+)$/.exec(name);
  if (!raw && ollama) {
    const model = ollama[1].trim();
    if (!/^[\w.:/-]+$/.test(model) || model.startsWith('-')) {
      throw new Error(`Invalid ollama model "${model}".`);
    }
    raw = ollamaRunner(model);
  }
  if (!raw) {
    throw new Error(
      `Unknown runner "${name}". Available runners: ${listRunnerNames(configRunners).join(', ')}, or ollama:<model>. Define custom runners in .aidiff.json under "runners".`,
    );
  }
  if (typeof raw.command !== 'string' || raw.command.trim().length === 0) {
    throw new Error(`Runner "${name}" is invalid: "command" must be a non-empty string.`);
  }
  const input: RunnerInput = raw.headless?.input === 'promptFileArg' ? 'promptFileArg' : 'stdin';
  return {
    name,
    command: raw.command,
    args: Array.isArray(raw.args) ? raw.args : [],
    headless: {
      args: Array.isArray(raw.headless?.args) ? raw.headless.args : [],
      input,
    },
    interactive:
      raw.interactive === false
        ? null
        : {
            args: Array.isArray(raw.interactive?.args)
              ? raw.interactive.args
              : ['{promptFileInstruction}'],
          },
    timeoutMs: typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0 ? raw.timeoutMs : 600_000,
    install: raw.install,
  };
}

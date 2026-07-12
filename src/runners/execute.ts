import { spawn } from 'node:child_process';
import type { ResolvedRunner, RunnerResult } from './types.js';

export type PlaceholderContext = {
  promptFile?: string;
  promptFileInstruction?: string;
};

export function substitutePlaceholders(args: string[], ctx: PlaceholderContext): string[] {
  return args.map((a) =>
    a
      .replace('{promptFile}', () => ctx.promptFile ?? '')
      .replace('{promptFileInstruction}', () => ctx.promptFileInstruction ?? ''),
  );
}

function notFoundError(runner: ResolvedRunner): string {
  const hint =
    runner.name === 'claude'
      ? ' Install it with: npm i -g @anthropic-ai/claude-code'
      : ' Install it, or define a runner in .aidiff.json under "runners".';
  return `Runner "${runner.name}" not found on PATH (command: ${runner.command}).${hint}`;
}

// Runs the runner headlessly: prompt via stdin (or prompt file path as an
// argument when the runner is configured with input: 'promptFileArg').
export async function runHeadless(
  runner: ResolvedRunner,
  prompt: string,
  opts: { promptFile?: string } = {},
): Promise<RunnerResult> {
  let args = [...runner.args, ...runner.headless.args];
  const useStdin = runner.headless.input === 'stdin';
  if (!useStdin) {
    if (!opts.promptFile) {
      return {
        ok: false,
        error: `Runner "${runner.name}" uses promptFileArg input but no prompt file was provided.`,
      };
    }
    if (args.some((a) => a.includes('{promptFile}'))) {
      args = substitutePlaceholders(args, { promptFile: opts.promptFile });
    } else {
      args = [...args, opts.promptFile];
    }
  }

  return new Promise((resolve) => {
    const child = spawn(runner.command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: RunnerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      finish({
        ok: false,
        error: `Runner "${runner.name}" timed out after ${Math.round(runner.timeoutMs / 1000)}s.`,
      });
    }, runner.timeoutMs);

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf-8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf-8')));

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        ok: false,
        error:
          err.code === 'ENOENT'
            ? notFoundError(runner)
            : `Runner "${runner.name}" failed to start: ${err.message}`,
      });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || stdout.trim() || '(no output)';
        finish({ ok: false, error: `Runner "${runner.name}" exited with code ${code}: ${detail}` });
        return;
      }
      if (stdout.trim().length === 0) {
        finish({ ok: false, error: `Runner "${runner.name}" produced no output.` });
        return;
      }
      finish({ ok: true, output: stdout });
    });

    if (useStdin) {
      child.stdin.write(prompt);
    }
    child.stdin.end();
  });
}

// Launches the runner as an interactive session attached to the user's
// terminal, seeded with a short instruction (never the full prompt — argv
// size limits make that unsafe for large diffs).
export async function runInteractive(
  runner: ResolvedRunner,
  promptFileInstruction: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const args = substitutePlaceholders([...runner.args, ...runner.interactive.args], {
    promptFileInstruction,
  });
  return new Promise((resolve) => {
    const child = spawn(runner.command, args, { stdio: 'inherit' });
    child.on('error', (err: NodeJS.ErrnoException) => {
      resolve({
        ok: false,
        error:
          err.code === 'ENOENT'
            ? notFoundError(runner)
            : `Runner "${runner.name}" failed to start: ${err.message}`,
      });
    });
    child.on('close', (code) => {
      if (code === 0 || code === null) resolve({ ok: true });
      else resolve({ ok: false, error: `Runner "${runner.name}" exited with code ${code}.` });
    });
  });
}

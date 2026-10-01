import fs from 'node:fs';
import path from 'node:path';
// cross-spawn resolves Windows .cmd/.bat shims (how npm installs CLIs such as
// claude, codex or gemini), which plain child_process.spawn cannot launch.
import spawn from 'cross-spawn';
import { spawn as spawnPlain, type ChildProcess } from 'node:child_process';
import type { ResolvedRunner, RunnerResult } from './types.js';

// PATH lookup without spawning anything (honors PATHEXT on Windows).
export function findOnPath(command: string): string | null {
  const exts =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
      : [''];
  const isFile = (p: string) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (command.includes('/') || command.includes('\\')) {
    for (const ext of exts) if (isFile(command + ext)) return command + ext;
    return null;
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

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
  const hint = runner.install
    ? ` Install it: ${runner.install}`
    : ' Install it, or define a runner in .aidiff.json under "runners".';
  return `Runner "${runner.name}" not found on PATH (command: ${runner.command}).${hint}`;
}

// Stops a timed-out runner and everything it started. On Windows, npm CLIs run
// as `cmd.exe /c <tool>.cmd`, so killing the child alone would leave the real
// CLI running (and billing); taskkill /T takes down the whole tree.
function killTree(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnPlain('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    }).on('error', () => child.kill());
    return;
  }
  child.kill('SIGTERM');
  // Escalate if the runner ignores SIGTERM; cleared as soon as it exits.
  const force = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.once('exit', () => clearTimeout(force));
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
      resolve(result);
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish({
        ok: false,
        error: `Runner "${runner.name}" timed out after ${Math.round(runner.timeoutMs / 1000)}s.`,
      });
    }, runner.timeoutMs);

    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf-8')));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf-8')));

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

    // A runner that exits before reading all input must not crash us (EPIPE)
    child.stdin?.on('error', () => {});
    if (useStdin) {
      child.stdin?.write(prompt);
    }
    child.stdin?.end();
  });
}

// Runs a command attached to the user's terminal and resolves with its exit
// code (null when the process couldn't start).
export async function runCommandInherit(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code ?? 0));
  });
}

export type CommandCapture =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; notFound: boolean; code: number | null; stdout: string; stderr: string };

// Generic capture-output spawn for non-runner CLIs (e.g. glab). Kept here so
// this module stays the only one that touches child_process.
// `input` is written to stdin (used for large bodies that would not fit in argv).
export async function runCommandCapture(
  command: string,
  args: string[],
  opts: { input?: string } = {},
): Promise<CommandCapture> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString('utf-8')));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString('utf-8')));
    if (opts.input !== undefined) {
      child.stdin?.on('error', () => {});
      child.stdin?.end(opts.input);
    }
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, notFound: err.code === 'ENOENT', code: null, stdout, stderr });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ ok: true, stdout, stderr });
      else resolve({ ok: false, notFound: false, code, stdout, stderr });
    });
  });
}

// Launches the runner as an interactive session attached to the user's
// terminal, seeded with a short instruction (never the full prompt — argv
// size limits make that unsafe for large diffs).
export async function runInteractive(
  runner: ResolvedRunner,
  promptFileInstruction: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!runner.interactive) {
    return { ok: false, error: `Runner "${runner.name}" has no interactive mode.` };
  }
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

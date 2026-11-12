import spawn from 'cross-spawn';

export type ProcResult = { code: number | null; stdout: string; stderr: string; ms: number };

export type ProcOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onSpawn?: (kill: () => void) => void; // lets a caller abort a long-running step
  echo?: boolean; // stream output to the terminal as it arrives
};

// Capture-output spawn for the harness (gh, the diff2ai CLI, uv/python).
// cross-spawn resolves Windows .cmd shims the same way src/runners/execute.ts does.
export function runProc(
  command: string,
  args: string[],
  opts: ProcOptions = {},
): Promise<ProcResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    opts.onSpawn?.(() => child.kill());
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8');
      if (opts.echo) process.stdout.write(d);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
      if (opts.echo) process.stderr.write(d);
    });
    child.on('error', (err) =>
      resolve({
        code: null,
        stdout,
        stderr: stderr + String(err.message),
        ms: Date.now() - started,
      }),
    );
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
  });
}

// Removes ANSI colour codes and box-drawing noise from CLI output kept in records.
export function plain(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/[╭╮╰╯│─]/g, '');
}

export function lastLines(text: string, n: number): string {
  return plain(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(' | ');
}

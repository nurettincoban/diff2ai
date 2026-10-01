import path from 'node:path';
import chalk from 'chalk';
import { Command, InvalidArgumentError } from 'commander';
import { loadConfig, type AidiffConfig } from '../config/loadConfig.js';
import { isPathLike } from '../formatters/markdown.js';
import { parseBudget } from '../chunker/profiles.js';

export type GlobalFlags = { yes: boolean; interactive: boolean };

// --yes / --no-interactive from the root program, plus TTY detection:
// prompts only ever run when both stdin and stdout are terminals.
export function globalFlags(cmd: Command): GlobalFlags {
  const g = cmd.optsWithGlobals() as { yes?: boolean; interactive?: boolean };
  const tty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
  return { yes: Boolean(g.yes), interactive: g.interactive !== false && tty };
}

// Every command action runs through this: errors are printed once, in red,
// and always produce a non-zero exit code (scripts and agents rely on it).
export function withErrors<A extends unknown[]>(
  fn: (...args: A) => Promise<void> | void,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(message));
      process.exitCode = 1;
    }
  };
}

export function loadProjectConfig(root: string): AidiffConfig {
  const { config, warnings } = loadConfig(root);
  // "not found" is the normal case; only surface real problems
  for (const w of warnings) if (!/not found/i.test(w)) console.warn(chalk.yellow(w));
  return config;
}

// --out is relative to where the user is; the default lives at the project root.
export function resolveOutDir(out: string | undefined, root: string): string {
  return out ? path.resolve(process.cwd(), out) : path.join(root, 'reviews');
}

// CLI template paths are relative to the cwd, config paths to the project root.
export function resolveTemplateChoice(
  cli: { template?: string; templatesDir?: string },
  config: AidiffConfig,
  root: string,
): { template: string; templatesDir?: string } {
  const cwd = process.cwd();
  let template = 'default';
  if (cli.template) {
    template = isPathLike(cli.template) ? path.resolve(cwd, cli.template) : cli.template;
  } else if (config.template) {
    template = isPathLike(config.template) ? path.resolve(root, config.template) : config.template;
  }
  const templatesDir = cli.templatesDir
    ? path.resolve(cwd, cli.templatesDir)
    : config.templatesDir
      ? path.resolve(root, config.templatesDir)
      : undefined;
  return { template, templatesDir };
}

// A CLI value only counts when the user actually passed it; otherwise the
// config (then the default) applies. Needed for negatable flags like
// --no-line-numbers, whose implicit default would otherwise always win.
export function fromCliOr<T>(cmd: Command, key: string, cliValue: T, fallback: T): T {
  return cmd.getOptionValueSource(key) === 'cli' ? cliValue : fallback;
}

export function reportExcluded(excluded: string[]): void {
  if (excluded.length === 0) return;
  console.log(
    chalk.dim(
      `Excluded ${excluded.length} file(s) via exclude patterns (.aidiff.json / .aidiffignore).`,
    ),
  );
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

export function parseNonNegativeInt(flag: string) {
  return (value: string): number => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 0 || String(n) !== value.trim()) {
      throw new InvalidArgumentError(`${flag} must be an integer >= 0.`);
    }
    return n;
  };
}

export function parsePositiveInt(flag: string) {
  return (value: string): number => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== value.trim()) {
      throw new InvalidArgumentError(`${flag} must be a positive integer.`);
    }
    return n;
  };
}

export function parseBudgetOption(value: string): number {
  try {
    return parseBudget(value);
  } catch (e) {
    throw new InvalidArgumentError((e as Error).message);
  }
}

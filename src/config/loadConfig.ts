import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import type { RunnerConfig } from '../runners/types.js';

export type CliOverride = { command?: string; args?: string[] }; // gh / glab binary override

export type AidiffConfig = {
  target: string;
  profile: 'claude-large' | 'generic-large' | 'generic-medium';
  budget?: number; // raw token budget; overrides profile
  exclude: string[];
  template?: string;
  templatesDir?: string;
  lineNumbers?: boolean; // annotate diff lines with new-file line numbers (default true)
  contextLines?: number; // git diff -U<n>
  functionContext?: boolean; // git diff --function-context
  concurrency?: number; // parallel reviewer passes in consensus runs
  runners?: Record<string, RunnerConfig>;
  personas?: Record<string, string>;
  gitlab?: CliOverride; // glab CLI override for `post`
  github?: CliOverride; // gh CLI override for `post` and `review --pr`
};

const DEFAULT_CONFIG: AidiffConfig = {
  target: 'main',
  profile: 'generic-medium',
  exclude: ['**/*.lock', '**/dist/**', '**/*.min.*'],
  template: undefined,
  templatesDir: undefined,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function nonNegativeInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}

export function loadConfig(cwd: string = process.cwd()): {
  config: AidiffConfig;
  warnings: string[];
} {
  const warnings: string[] = [];
  const configPath = path.join(cwd, '.aidiff.json');

  if (!fs.existsSync(configPath)) {
    warnings.push('Config .aidiff.json not found. Using defaults.');
    return { config: { ...DEFAULT_CONFIG }, warnings };
  }

  try {
    const contents = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON5.parse(contents) as Partial<Record<keyof AidiffConfig, unknown>>;
    const merged: AidiffConfig = {
      target: typeof parsed.target === 'string' ? parsed.target : DEFAULT_CONFIG.target,
      profile: (parsed.profile as AidiffConfig['profile']) ?? DEFAULT_CONFIG.profile,
      budget: (nonNegativeInt(parsed.budget) ?? 0) >= 1000 ? (parsed.budget as number) : undefined,
      exclude: Array.isArray(parsed.exclude)
        ? (parsed.exclude as string[])
        : DEFAULT_CONFIG.exclude,
      template: typeof parsed.template === 'string' ? parsed.template : DEFAULT_CONFIG.template,
      templatesDir:
        typeof parsed.templatesDir === 'string' ? parsed.templatesDir : DEFAULT_CONFIG.templatesDir,
      lineNumbers: typeof parsed.lineNumbers === 'boolean' ? parsed.lineNumbers : undefined,
      contextLines: nonNegativeInt(parsed.contextLines),
      functionContext:
        typeof parsed.functionContext === 'boolean' ? parsed.functionContext : undefined,
      concurrency:
        typeof parsed.concurrency === 'number' && parsed.concurrency >= 1
          ? Math.floor(parsed.concurrency)
          : undefined,
      runners: isRecord(parsed.runners)
        ? (parsed.runners as Record<string, RunnerConfig>)
        : undefined,
      personas: isRecord(parsed.personas) ? (parsed.personas as Record<string, string>) : undefined,
      gitlab: isRecord(parsed.gitlab) ? (parsed.gitlab as CliOverride) : undefined,
      github: isRecord(parsed.github) ? (parsed.github as CliOverride) : undefined,
    };
    return { config: merged, warnings };
  } catch {
    warnings.push('Failed to parse .aidiff.json. Falling back to defaults.');
    return { config: { ...DEFAULT_CONFIG }, warnings };
  }
}

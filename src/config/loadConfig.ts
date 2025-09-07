import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';

export type AidiffConfig = {
  target: string;
  profile: 'claude-large' | 'generic-large' | 'generic-medium';
  include: string[];
  exclude: string[];
};

const DEFAULT_CONFIG: AidiffConfig = {
  target: 'main',
  profile: 'generic-large',
  include: ['src/**', 'apps/**'],
  exclude: ['**/*.lock', 'dist/**', '**/*.min.*'],
};

export function loadConfig(cwd: string = process.cwd()): { config: AidiffConfig; warnings: string[] } {
  const warnings: string[] = [];
  const configPath = path.join(cwd, '.aidiff.json');

  if (!fs.existsSync(configPath)) {
    warnings.push('Config .aidiff.json not found. Using defaults.');
    return { config: DEFAULT_CONFIG, warnings };
  }

  try {
    const contents = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON5.parse(contents) as Partial<AidiffConfig>;
    const merged: AidiffConfig = {
      target: parsed.target ?? DEFAULT_CONFIG.target,
      profile: (parsed.profile as AidiffConfig['profile']) ?? DEFAULT_CONFIG.profile,
      include: Array.isArray(parsed.include) ? parsed.include : DEFAULT_CONFIG.include,
      exclude: Array.isArray(parsed.exclude) ? parsed.exclude : DEFAULT_CONFIG.exclude,
    };
    return { config: merged, warnings };
  } catch (error) {
    warnings.push('Failed to parse .aidiff.json. Falling back to defaults.');
    return { config: DEFAULT_CONFIG, warnings };
  }
}

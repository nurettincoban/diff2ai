#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const program = new Command();

function resolvePackageVersion(): string {
  // Prefer reading from installed package.json at runtime
  try {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require('../package.json');
    if (pkg?.version) return String(pkg.version);
  } catch {
    // ignore and try fs path below
  }
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(moduleDir, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const raw = fs.readFileSync(pkgPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.version) return String(parsed.version);
    }
  } catch {
    // ignore
  }
  return '0.0.0';
}

program
  .name('diff2ai')
  .description('Extract Git diffs and generate AI-ready review prompts')
  .version(resolvePackageVersion())
  .option('--no-interactive', 'Disable interactive prompts')
  .option('--yes', 'Auto-confirm safe prompts');

registerCommands(program);

program
  .command('help', { isDefault: false })
  .description('Show help')
  .action(() => {
    program.outputHelp();
  });

program.parseAsync(process.argv);

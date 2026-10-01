#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { errorBox } from './ux/theme.js';
import { packageVersion } from './version.js';

const program = new Command();

program
  .name('diff2ai')
  .description('Turn Git diffs into high-signal AI code reviews')
  .version(packageVersion())
  .option('--no-interactive', 'Disable interactive prompts')
  .option('--yes', 'Auto-confirm safe prompts');

registerCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(errorBox([message]));
  process.exit(1);
});

#!/usr/bin/env node
import { Command } from 'commander';
import { registerCommands } from './commands/index.js';

const program = new Command();

program
  .name('diff2ai')
  .description('Extract Git diffs and generate AI-ready review prompts')
  .version('0.0.1')
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

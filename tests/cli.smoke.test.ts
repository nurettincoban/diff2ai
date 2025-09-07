import { execSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe('CLI', () => {
  it('shows help output', () => {
    const output = execSync('node dist/cli.js --help', { encoding: 'utf-8' });
    expect(output).toMatch(/Usage: diff2ai/);
  });
});

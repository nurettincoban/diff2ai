import boxen from 'boxen';
import chalk from 'chalk';

export function header(title: string, subtitle?: string): string {
  const content = [chalk.bold(title), subtitle ? chalk.dim(subtitle) : undefined]
    .filter(Boolean)
    .join('\n');
  return boxen(content, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'cyan' });
}

export function success(summaryLines: string[]): string {
  const content = summaryLines.join('\n');
  return boxen(content, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'green' });
}

export function errorBox(lines: string[]): string {
  const content = lines.join('\n');
  return boxen(content, { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'red' });
}

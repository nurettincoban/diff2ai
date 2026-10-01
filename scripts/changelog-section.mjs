// Prints the CHANGELOG.md section for one version (used for GitHub Release notes).
// Usage: node scripts/changelog-section.mjs 0.3.0
import fs from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version>');
  process.exit(2);
}

const lines = fs.readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf-8').split('\n');
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start === -1) {
  console.error(`No "## [${version}]" section in CHANGELOG.md`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith('## ['));
process.stdout.write(
  (end === -1 ? rest : rest.slice(0, end)).join('\n').trim() +
    '\n\nFull changelog: https://github.com/nurettincoban/diff2ai/blob/main/CHANGELOG.md\n',
);

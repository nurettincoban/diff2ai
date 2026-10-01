// Stand-in for the GitHub CLI used by `post` / `review --pr` integration
// tests. Appends one JSON line per call ({ args, input }) to FAKE_GH_LOG.
//
// Env knobs:
//   FAKE_GH_LOG          file to append call records to
//   FAKE_GH_DIFF         file whose contents `gh pr diff` prints
//   FAKE_GH_BASE         base branch printed by `gh pr view <n> --json baseRefName`
//   FAKE_GH_PR           PR number printed by `gh pr view --json number`
//   FAKE_GH_REVIEW_FAIL  "1" → the reviews API call fails with a 422
import fs from 'node:fs';

const args = process.argv.slice(2);

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

const needsInput = args.includes('--input') || args.includes('--body-file');
const input = needsInput ? readStdin() : undefined;

if (process.env.FAKE_GH_LOG) {
  fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, input }) + '\n', 'utf-8');
}

const [group, sub] = args;
if (group === 'pr' && sub === 'view') {
  if (args.includes('baseRefName')) console.log(process.env.FAKE_GH_BASE ?? 'main');
  else console.log(process.env.FAKE_GH_PR ?? '7');
} else if (group === 'pr' && sub === 'diff') {
  process.stdout.write(fs.readFileSync(process.env.FAKE_GH_DIFF, 'utf-8'));
} else if (group === 'pr' && sub === 'comment') {
  console.log('https://github.com/acme/app/pull/7#issuecomment-1');
} else if (group === 'api') {
  if (process.env.FAKE_GH_REVIEW_FAIL === '1') {
    console.error('gh: Validation Failed (HTTP 422)');
    process.exit(1);
  }
  console.log(JSON.stringify({ id: 1, html_url: 'https://github.com/acme/app/pull/7#pullrequestreview-1' }));
} else {
  console.error(`fake-gh: unsupported command: ${args.join(' ')}`);
  process.exit(2);
}

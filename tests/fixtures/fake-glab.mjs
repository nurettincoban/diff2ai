// Stand-in for the glab CLI used by `post` integration tests. Records its
// argv to the file given in FAKE_GLAB_LOG and prints a fake note URL.
import fs from 'node:fs';

if (process.env.FAKE_GLAB_FAIL === '1') {
  console.error('fake-glab: forced failure (not authenticated)');
  process.exit(1);
}

const log = process.env.FAKE_GLAB_LOG;
if (log) {
  fs.writeFileSync(log, JSON.stringify(process.argv.slice(2)), 'utf-8');
}
console.log('https://gitlab.example.com/group/project/-/merge_requests/42#note_123');

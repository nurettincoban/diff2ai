// Deterministic stand-in for an AI runner (e.g. claude -p) used by the
// integration tests. Reads the prompt from stdin and emits canned review
// output in the diff2ai issue-block schema.
//
// Env knobs:
//   FAKE_RUNNER_FAIL_MATCH  regex; exit 1 when the prompt matches
//   FAKE_RUNNER_EMPTY       "1" → exit 0 with no output
//   FAKE_RUNNER_SLEEP_MS    delay before responding (timeout tests)
//   FAKE_RUNNER_LOG         file to append {kind, start, end} JSON lines to
//   FAKE_RUNNER_IGNORE_TERM "1" → ignore SIGTERM (timeout escalation tests)
import fs from 'node:fs';

if (process.env.FAKE_RUNNER_IGNORE_TERM === '1') process.on('SIGTERM', () => {});

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks).toString('utf-8');
  const started = Date.now();
  const logSpan = (kind) => {
    if (!process.env.FAKE_RUNNER_LOG) return;
    fs.appendFileSync(
      process.env.FAKE_RUNNER_LOG,
      JSON.stringify({ kind, start: started, end: Date.now() }) + '\n',
    );
  };

  const failMatch = process.env.FAKE_RUNNER_FAIL_MATCH;
  if (failMatch && new RegExp(failMatch, 'i').test(input)) {
    console.error('fake-runner: forced failure');
    process.exit(1);
  }
  if (process.env.FAKE_RUNNER_EMPTY === '1') {
    process.exit(0);
  }

  const respond = () => {
    if (input.includes('Output ONLY persona selections')) {
      // AI persona-selection mode: deterministic pick for tests.
      process.stdout.write('security: canned AI selection\ncorrectness: canned AI selection\n');
      logSpan('select');
      process.exit(0);
    }
    if (input.includes('# Consolidation and Validation Instructions')) {
      // Judge mode: count the review sections actually present in the prompt
      // so tests can assert the judge saw every successful iteration.
      const reviewCount = (input.match(/^--- REVIEW \d+ \(persona: /gm) ?? []).length;
      const hasDiff = input.includes('--- START DIFF ---');
      const blocks = [
        [
          `## 1) Severity: HIGH | Type: Bug`,
          `Consensus: ${reviewCount}/${reviewCount} reviewers`,
          `Title: Shared finding (judge saw diff: ${hasDiff})`,
          '',
          'Affected:',
          '- file.txt:1-2',
          '',
          'Explanation:',
          'Consolidated from all reviewers.',
          '',
          'Proposed fix:',
          '~~~txt',
          'fix it',
          '~~~',
        ].join('\n'),
      ];
      if (process.env.FAKE_RUNNER_JUDGE_BOGUS === '1') {
        // A hallucinated finding: ghost.js is not part of any test diff.
        blocks.push(
          [
            `## 2) Severity: CRITICAL | Type: Security`,
            `Consensus: 1/${reviewCount} reviewers`,
            'Title: Ghost finding in a file outside the diff',
            '',
            'Affected:',
            '- ghost.js:10-12',
            '',
            'Explanation:',
            'Fabricated by the judge.',
          ].join('\n'),
        );
      }
      process.stdout.write(blocks.join('\n\n') + '\n');
      logSpan('judge');
      process.exit(0);
    }

    const personaMatch = input.match(/^# Reviewer Persona: (.+)$/m);
    const persona = personaMatch ? personaMatch[1].trim() : 'No Persona';
    process.stdout.write(
      [
        `## 1) Severity: HIGH | Type: Bug`,
        `Title: Shared finding`,
        '',
        'Affected:',
        '- file.txt:1-2',
        '',
        'Explanation:',
        `Found by every persona.`,
        '',
        `## 2) Severity: LOW | Type: Style`,
        `Title: Unique to ${persona}`,
        '',
        'Affected:',
        '- file.txt:3-3',
        '',
        'Explanation:',
        `Only the ${persona} reviewer reports this.`,
        '',
      ].join('\n'),
    );
    logSpan(personaMatch ? 'reviewer' : 'single');
    process.exit(0);
  };

  const sleepMs = Number.parseInt(process.env.FAKE_RUNNER_SLEEP_MS ?? '0', 10);
  if (sleepMs > 0) setTimeout(respond, sleepMs);
  else respond();
});

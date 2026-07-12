// Deterministic stand-in for an AI runner (e.g. claude -p) used by the
// integration tests. Reads the prompt from stdin and emits canned review
// output in the diff2ai issue-block schema.
//
// Env knobs:
//   FAKE_RUNNER_FAIL_MATCH  regex; exit 1 when the prompt matches
//   FAKE_RUNNER_EMPTY       "1" → exit 0 with no output
//   FAKE_RUNNER_SLEEP_MS    delay before responding (timeout tests)

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', () => {
  const input = Buffer.concat(chunks).toString('utf-8');

  const failMatch = process.env.FAKE_RUNNER_FAIL_MATCH;
  if (failMatch && new RegExp(failMatch, 'i').test(input)) {
    console.error('fake-runner: forced failure');
    process.exit(1);
  }
  if (process.env.FAKE_RUNNER_EMPTY === '1') {
    process.exit(0);
  }

  const respond = () => {
    if (input.includes('# Consolidation and Validation Instructions')) {
      // Judge mode: count the review sections actually present in the prompt
      // so tests can assert the judge saw every successful iteration.
      const reviewCount = (input.match(/^--- REVIEW \d+ \(persona: /gm) ?? []).length;
      const hasDiff = input.includes('--- START DIFF ---');
      process.stdout.write(
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
          '',
        ].join('\n'),
      );
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
    process.exit(0);
  };

  const sleepMs = Number.parseInt(process.env.FAKE_RUNNER_SLEEP_MS ?? '0', 10);
  if (sleepMs > 0) setTimeout(respond, sleepMs);
  else respond();
});

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import { parseFindings, parseSeverity } from '../src/formatters/findings.js';
import { formatMrComment } from '../src/integrations/gitlab.js';

function run(cmd: string, cwd: string, env: Record<string, string> = {}) {
  return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', env: { ...process.env, ...env } });
}

const projectRoot = path.resolve(process.cwd());
const cli = path.join(projectRoot, 'dist', 'cli.js');
const fakeGlab = path.join(projectRoot, 'tests', 'fixtures', 'fake-glab.mjs');

const SAMPLE_REVIEW = `<!-- Note: 1 reviewer pass(es) failed (X); consensus is out of 2 successful reviewers. -->

## 1) Severity: CRITICAL | Type: Security
Consensus: 2/2 reviewers
Title: Fix SQL injection in runUserQuery

Affected:
- src/auth.js:6-7

Explanation:
String concatenation into SQL enables injection.

Proposed fix:
~~~js
db.query('SELECT * FROM users WHERE name = ?', [name]);
~~~

## 2) Severity: LOW | Type: Style
Consensus: 1/2 reviewers
Title: Prefer strict equality

Affected:
- src/auth.js:3

Explanation:
Loose equality coerces types.
`;

function makeWorkspace(prefix: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(tmp, 'consolidated.md'), SAMPLE_REVIEW);
  fs.writeFileSync(
    path.join(tmp, '.aidiff.json'),
    JSON.stringify({ gitlab: { command: process.execPath, args: [fakeGlab] } }),
  );
  return tmp;
}

describe('post integration', () => {
  beforeAll(() => {
    if (!fs.existsSync(cli)) run('npm run -s build', projectRoot);
  });

  it('posts a formatted comment through glab with --yes', () => {
    const tmp = makeWorkspace('diff2ai-post-');
    const log = path.join(tmp, 'glab.log');
    const out = run(`node ${cli} --yes post consolidated.md --mr 42 2>&1`, tmp, {
      FAKE_GLAB_LOG: log,
    });
    expect(out).toMatch(/Comment posted/);
    expect(out).toMatch(/note_123/);

    const args = JSON.parse(fs.readFileSync(log, 'utf-8')) as string[];
    // fake-glab receives: mr note 42 --message <body>
    expect(args.slice(0, 3)).toEqual(['mr', 'note', '42']);
    const body = args[args.length - 1];
    expect(body).toMatch(/AI consensus review/);
    expect(body).toMatch(/CRITICAL/);
    expect(body).toMatch(/Fix SQL injection/);
    expect(body).toMatch(/consensus: 2\/2 reviewers/);
    expect(body).toMatch(/src\/auth\.js:6-7/);
  });

  it('requires --yes in non-interactive mode and posts nothing without it', () => {
    const tmp = makeWorkspace('diff2ai-post-noyes-');
    const log = path.join(tmp, 'glab.log');
    let failed = false;
    try {
      run(`node ${cli} post consolidated.md --mr 42 2>&1`, tmp, { FAKE_GLAB_LOG: log });
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/requires confirmation/);
    }
    expect(failed).toBe(true);
    expect(fs.existsSync(log)).toBe(false);
  });

  it('--dry-run prints the comment without invoking glab', () => {
    const tmp = makeWorkspace('diff2ai-post-dry-');
    const log = path.join(tmp, 'glab.log');
    const out = run(`node ${cli} post consolidated.md --dry-run 2>&1`, tmp, {
      FAKE_GLAB_LOG: log,
    });
    expect(out).toMatch(/would be posted/);
    expect(out).toMatch(/Fix SQL injection/);
    expect(fs.existsSync(log)).toBe(false);
  });

  it('--min-severity filters findings; nothing to post is graceful', () => {
    const tmp = makeWorkspace('diff2ai-post-sev-');
    const log = path.join(tmp, 'glab.log');
    const out = run(
      `node ${cli} --yes post consolidated.md --mr 42 --min-severity HIGH 2>&1`,
      tmp,
      { FAKE_GLAB_LOG: log },
    );
    expect(out).toMatch(/Filtered 1 finding\(s\) below HIGH/);
    const logged = JSON.parse(fs.readFileSync(log, 'utf-8')) as string[];
    const body = logged[logged.length - 1];
    expect(body).toMatch(/Fix SQL injection/);
    expect(body).not.toMatch(/Prefer strict equality/);

    // all findings filtered out → graceful no-op
    const out2 = run(
      `node ${cli} --yes post consolidated.md --min-severity CRITICAL --dry-run 2>&1`,
      tmp,
    );
    expect(out2).not.toMatch(/Prefer strict equality/);
  });

  it('handles the no-issues sentinel and unparseable files', () => {
    const tmp = makeWorkspace('diff2ai-post-empty-');
    fs.writeFileSync(path.join(tmp, 'clean.md'), 'No validated issues.\n');
    const out = run(`node ${cli} --yes post clean.md 2>&1`, tmp);
    expect(out).toMatch(/nothing to post/i);

    fs.writeFileSync(path.join(tmp, 'garbage.md'), '# just some notes\n');
    let failed = false;
    try {
      run(`node ${cli} --yes post garbage.md 2>&1`, tmp);
    } catch (e: unknown) {
      failed = true;
      const out2 =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out2).toMatch(/No findings parsed/);
    }
    expect(failed).toBe(true);
  });

  it('surfaces glab failures with guidance', () => {
    const tmp = makeWorkspace('diff2ai-post-fail-');
    let failed = false;
    try {
      run(`node ${cli} --yes post consolidated.md --mr 42 2>&1`, tmp, { FAKE_GLAB_FAIL: '1' });
    } catch (e: unknown) {
      failed = true;
      const out =
        String((e as { stdout?: string }).stdout ?? '') +
        String((e as { stderr?: string }).stderr ?? '');
      expect(out).toMatch(/exited with code 1/);
      expect(out).toMatch(/not authenticated/);
    }
    expect(failed).toBe(true);
  });
});

describe('findings parsing and formatting units', () => {
  it('parseFindings extracts schema fields and ignores non-block content', () => {
    const findings = parseFindings(SAMPLE_REVIEW);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      severity: 'CRITICAL',
      type: 'Security',
      title: 'Fix SQL injection in runUserQuery',
      consensus: '2/2 reviewers',
      affected: ['src/auth.js:6-7'],
    });
    expect(findings[0].proposedFix).toMatch(/db\.query/);
    expect(findings[1].severity).toBe('LOW');
    expect(findings[1].proposedFix).toBeUndefined();
    expect(parseFindings('# nothing here')).toHaveLength(0);
  });

  it('formatMrComment sorts by severity and escapes HTML in titles', () => {
    const findings = parseFindings(SAMPLE_REVIEW).reverse(); // LOW first on purpose
    const body = formatMrComment(findings, { source: 'consolidated.md' });
    expect(body.indexOf('CRITICAL')).toBeLessThan(body.indexOf('LOW'));
    expect(body).toMatch(/2 finding\(s\)/);
    expect(body).toMatch(/<details>/);
    const withHtml = formatMrComment([
      { severity: 'HIGH', type: 'Bug', title: 'Avoid <script> tags', affected: [] },
    ]);
    expect(withHtml).toContain('&lt;script&gt;');
  });

  it('parseSeverity validates input', () => {
    expect(parseSeverity('high')).toBe('HIGH');
    expect(() => parseSeverity('URGENT')).toThrow(/Unknown severity/);
  });
});

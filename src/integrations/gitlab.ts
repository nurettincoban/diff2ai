import { runCommandCapture } from '../runners/execute.js';
import {
  SEVERITY_ORDER,
  severityRank,
  type Finding,
  type Severity,
} from '../formatters/findings.js';

const SEVERITY_BADGE: Record<Severity, string> = {
  CRITICAL: '🟥 CRITICAL',
  HIGH: '🟧 HIGH',
  MEDIUM: '🟨 MEDIUM',
  LOW: '🟦 LOW',
  INFO: '⬜ INFO',
};

export type GitlabConfig = {
  command?: string; // defaults to "glab"; overridable for tests/wrappers
  args?: string[]; // always prepended
};

// Renders findings as a single GitLab-flavored-markdown MR note.
export function formatMrComment(findings: Finding[], opts: { source?: string } = {}): string {
  const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const counts = SEVERITY_ORDER.map((s) => {
    const n = sorted.filter((f) => f.severity === s).length;
    return n > 0 ? `${n} ${s.toLowerCase()}` : null;
  })
    .filter(Boolean)
    .join(' · ');

  const lines: string[] = [
    `## 🤖 AI consensus review (diff2ai)`,
    '',
    `**${sorted.length} finding(s)** — ${counts}`,
    '',
  ];

  sorted.forEach((f, i) => {
    lines.push(
      `<details><summary><b>${i + 1}. ${SEVERITY_BADGE[f.severity]}</b> · ${escapeHtml(f.title)}${f.consensus ? ` <i>(consensus: ${escapeHtml(f.consensus)})</i>` : ''}</summary>`,
      '',
    );
    if (f.affected.length > 0) {
      lines.push(...f.affected.map((a) => `- \`${a}\``), '');
    }
    if (f.explanation) lines.push(f.explanation, '');
    if (f.proposedFix) {
      // GitLab renders ~~~ fences fine; keep verbatim
      lines.push('**Proposed fix:**', '', f.proposedFix, '');
    }
    lines.push('</details>', '');
  });

  lines.push('---', '');
  lines.push(
    `<sub>Generated locally with [diff2ai](https://github.com/nurettincoban/diff2ai)${opts.source ? ` from \`${opts.source}\`` : ''}. Findings were cross-validated by multiple AI reviewer passes; treat as reviewer input, not a verdict.</sub>`,
  );
  return lines.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type PostResult = { ok: true; output: string } | { ok: false; error: string };

// Posts a note on a GitLab MR via the user's authenticated glab CLI.
// diff2ai itself makes no network calls — glab owns auth and transport.
export async function postMrNote(
  body: string,
  opts: { mr?: string; gitlab?: GitlabConfig } = {},
): Promise<PostResult> {
  const command = opts.gitlab?.command ?? 'glab';
  const baseArgs = Array.isArray(opts.gitlab?.args) ? opts.gitlab.args : [];
  const args = [...baseArgs, 'mr', 'note'];
  if (opts.mr) args.push(opts.mr);
  args.push('--message', body);

  const res = await runCommandCapture(command, args);
  if (res.ok) return { ok: true, output: res.stdout.trim() };
  if (res.notFound) {
    return {
      ok: false,
      error: `"${command}" not found on PATH. Install the GitLab CLI (https://gitlab.com/gitlab-org/cli) and run "glab auth login" first.`,
    };
  }
  return {
    ok: false,
    error: `${command} exited with code ${res.code}: ${res.stderr.trim() || res.stdout.trim() || '(no output)'}`,
  };
}

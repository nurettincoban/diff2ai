import {
  SEVERITY_ORDER,
  severityRank,
  type Finding,
  type Severity,
} from '../formatters/findings.js';

export const SEVERITY_BADGE: Record<Severity, string> = {
  CRITICAL: '🟥 CRITICAL',
  HIGH: '🟧 HIGH',
  MEDIUM: '🟨 MEDIUM',
  LOW: '🟦 LOW',
  INFO: '⬜ INFO',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

export function severityCounts(findings: Finding[]): string {
  return SEVERITY_ORDER.map((s) => {
    const n = findings.filter((f) => f.severity === s).length;
    return n > 0 ? `${n} ${s.toLowerCase()}` : null;
  })
    .filter(Boolean)
    .join(' · ');
}

function isConsensus(findings: Finding[]): boolean {
  return findings.some((f) => f.consensus);
}

export function commentHeading(findings: Finding[]): string {
  return isConsensus(findings)
    ? '## 🤖 AI consensus review (diff2ai)'
    : '## 🤖 AI review (diff2ai)';
}

export function commentFooter(findings: Finding[], source?: string): string {
  const how = isConsensus(findings)
    ? 'Findings were cross-validated by multiple AI reviewer passes; treat them as reviewer input, not a verdict.'
    : 'Treat findings as reviewer input, not a verdict.';
  return `<sub>Generated locally with [diff2ai](https://github.com/nurettincoban/diff2ai)${source ? ` from \`${source}\`` : ''}. ${how}</sub>`;
}

// One finding as a collapsible block (GitHub and GitLab both render <details>).
export function findingDetails(f: Finding, index: number): string[] {
  const lines = [
    `<details><summary><b>${index}. ${SEVERITY_BADGE[f.severity]}</b> · ${escapeHtml(f.title)}${f.consensus ? ` <i>(consensus: ${escapeHtml(f.consensus)})</i>` : ''}</summary>`,
    '',
  ];
  if (f.affected.length > 0) lines.push(...f.affected.map((a) => `- \`${a}\``), '');
  if (f.explanation) lines.push(f.explanation, '');
  if (f.proposedFix) lines.push('**Proposed fix:**', '', f.proposedFix, '');
  lines.push('</details>', '');
  return lines;
}

// Renders findings as a single markdown comment for an MR/PR.
export function formatSummaryComment(findings: Finding[], opts: { source?: string } = {}): string {
  const sorted = sortBySeverity(findings);
  const lines: string[] = [
    commentHeading(sorted),
    '',
    `**${sorted.length} finding(s)** — ${severityCounts(sorted)}`,
    '',
  ];
  sorted.forEach((f, i) => lines.push(...findingDetails(f, i + 1)));
  lines.push('---', '', commentFooter(sorted, opts.source));
  return lines.join('\n');
}

// Body of an inline (line-anchored) review comment.
export function formatInlineComment(f: Finding): string {
  const lines = [
    `**${SEVERITY_BADGE[f.severity]}** · ${escapeHtml(f.type)} — **${escapeHtml(f.title)}**${f.consensus ? ` _(consensus: ${escapeHtml(f.consensus)})_` : ''}`,
    '',
  ];
  if (f.explanation) lines.push(f.explanation, '');
  if (f.proposedFix) lines.push('**Proposed fix:**', '', f.proposedFix, '');
  return lines.join('\n').trimEnd();
}

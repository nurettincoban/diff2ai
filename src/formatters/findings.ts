export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export type Finding = {
  severity: Severity;
  type: string;
  title: string;
  consensus?: string; // e.g. "3/5 reviewers"
  affected: string[]; // e.g. ["src/auth.ts:42-57"]
  explanation?: string;
  proposedFix?: string; // fenced snippet, verbatim
  raw: string; // the whole block, verbatim (for reconstruction)
  verificationFailed?: boolean; // marked by the post-judge verification gate
};

export function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

export function parseSeverity(input: string): Severity {
  const upper = input.trim().toUpperCase();
  if ((SEVERITY_ORDER as string[]).includes(upper)) return upper as Severity;
  throw new Error(`Unknown severity "${input}". Valid: ${SEVERITY_ORDER.join(', ')}`);
}

function sectionAfter(block: string, label: string): string | undefined {
  // Captures the text following "Label:" up to the next known section or end
  const re = new RegExp(
    `^${label}:\\s*\\n?([\\s\\S]*?)(?=^(?:Affected|Explanation|Proposed fix|Consensus|Title|Verification):|\\n## |$)`,
    'm',
  );
  const m = re.exec(block);
  const text = m?.[1]?.trim();
  return text && text.length > 0 ? text : undefined;
}

// Parses numbered issue blocks in the diff2ai review schema:
//   ## <n>) Severity: HIGH | Type: Bug
//   Consensus: 3/5 reviewers        (optional, consensus runs only)
//   Title: ...
//   Affected: (- path:lines)*
//   Explanation: ...
//   Proposed fix: ~~~...~~~
// Content outside issue blocks (headers, HTML comments) is ignored.
export function parseFindings(markdown: string): Finding[] {
  const findings: Finding[] = [];
  const blockRe = /^## \d+\)\s*Severity:\s*([A-Z]+)\s*\|\s*Type:\s*([^\n]+)$/gm;
  const starts: { index: number; severity: string; type: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(markdown)) !== null) {
    starts.push({ index: m.index, severity: m[1], type: m[2].trim() });
  }
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].index : markdown.length;
    const block = markdown.slice(start.index, end);

    let severity: Severity;
    try {
      severity = parseSeverity(start.severity);
    } catch {
      continue; // not a valid issue block
    }

    const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? '(untitled finding)';
    const consensus = /^Consensus:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const affected: string[] = [];
    const affectedSection = sectionAfter(block, 'Affected');
    if (affectedSection) {
      for (const line of affectedSection.split(/\r?\n/)) {
        const item = /^-\s*(.+)$/.exec(line.trim())?.[1];
        if (item) affected.push(item.trim());
      }
    }
    const explanation = sectionAfter(block, 'Explanation');
    const fixMatch = /^Proposed fix:\s*\n(~~~[\s\S]*?~~~|```[\s\S]*?```)/m.exec(block);

    findings.push({
      severity,
      type: start.type,
      title,
      consensus,
      affected,
      explanation,
      proposedFix: fixMatch?.[1],
      raw: block.trim(),
      verificationFailed: /^Verification:\s*failed/m.test(block) || undefined,
    });
  }
  return findings;
}

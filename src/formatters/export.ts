import { parseAffected, type Finding, type Severity } from './findings.js';

const SARIF_LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  CRITICAL: 'error',
  HIGH: 'error',
  MEDIUM: 'warning',
  LOW: 'note',
  INFO: 'note',
};

// GitHub code scanning orders alerts by this score (0.0–10.0).
const SECURITY_SEVERITY: Record<Severity, string> = {
  CRITICAL: '9.5',
  HIGH: '8.0',
  MEDIUM: '5.5',
  LOW: '3.0',
  INFO: '1.0',
};

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'finding'
  );
}

export type ExportMeta = { version: string; source?: string };

export function toJson(findings: Finding[], meta: ExportMeta): string {
  return JSON.stringify(
    {
      tool: 'diff2ai',
      version: meta.version,
      source: meta.source,
      findings: findings.map((f) => ({
        severity: f.severity,
        type: f.type,
        title: f.title,
        consensus: f.consensus,
        verified: !f.verificationFailed,
        locations: f.affected.map((a) => parseAffected(a) ?? { path: a }),
        explanation: f.explanation,
        proposedFix: f.proposedFix,
      })),
    },
    null,
    2,
  );
}

// Code scanning rejects results without a location, so SARIF only carries
// findings that name at least one file.
export function hasLocation(f: Finding): boolean {
  return f.affected.some((a) => parseAffected(a) !== null);
}

// SARIF 2.1.0 — consumable by GitHub code scanning (upload-sarif) and most
// static-analysis dashboards. Findings without a file location are left out
// (see hasLocation); callers report how many.
export function toSarif(allFindings: Finding[], meta: ExportMeta): string {
  const findings = allFindings.filter(hasLocation);
  const types = [...new Set(findings.map((f) => f.type))];
  const rules = types.map((t) => ({
    id: `diff2ai/${slug(t)}`,
    name: t.replace(/[^A-Za-z0-9]/g, '') || 'Finding',
    shortDescription: { text: `AI review finding: ${t}` },
    properties: { tags: ['ai-review', slug(t)] },
  }));
  const results = findings.map((f) => {
    const locations = f.affected
      .map((a) => parseAffected(a))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => ({
        physicalLocation: {
          artifactLocation: { uri: r.path.replace(/\\/g, '/') },
          ...(r.start !== undefined
            ? {
                region: { startLine: Math.max(1, r.start), endLine: Math.max(1, r.end ?? r.start) },
              }
            : {}),
        },
      }));
    const text = [f.title, f.explanation, f.proposedFix ? `Proposed fix:\n${f.proposedFix}` : '']
      .filter(Boolean)
      .join('\n\n');
    return {
      ruleId: `diff2ai/${slug(f.type)}`,
      level: SARIF_LEVEL[f.severity],
      message: { text },
      locations,
      properties: {
        severity: f.severity,
        'security-severity': SECURITY_SEVERITY[f.severity],
        ...(f.consensus ? { consensus: f.consensus } : {}),
        ...(f.verificationFailed ? { verified: false } : {}),
      },
    };
  });
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'diff2ai',
              version: meta.version,
              informationUri: 'https://github.com/nurettincoban/diff2ai',
              rules,
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}

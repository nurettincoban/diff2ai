import fs from 'node:fs';
import path from 'node:path';
import {
  atOrAbove,
  parseFindings,
  reportsNoIssues,
  type Finding,
  type Severity,
} from './findings.js';

// Newest AI result under the output directory: a consensus run's
// consolidated.md or a headless run's *.response.md. Lets CI chain
// `review --run ...` with `post latest` / `export latest`.
export function findLatestReview(outDir: string): string | null {
  if (!fs.existsSync(outDir)) return null;
  const candidates: string[] = [];
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    const full = path.join(outDir, entry.name);
    if (entry.isDirectory() && entry.name.startsWith('run_')) {
      const consolidated = path.join(full, 'consolidated.md');
      if (fs.existsSync(consolidated)) candidates.push(consolidated);
    } else if (entry.isFile() && entry.name.endsWith('.response.md')) {
      candidates.push(full);
    }
  }
  candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

export function resolveReviewFile(arg: string, outDir: string): string {
  if (arg === 'latest') {
    const latest = findLatestReview(outDir);
    if (!latest) {
      throw new Error(
        `No review results found in ${outDir} (looked for run_*/consolidated.md and *.response.md).`,
      );
    }
    return latest;
  }
  const abs = path.resolve(process.cwd(), arg);
  if (!fs.existsSync(abs)) throw new Error(`Review file not found: ${arg}`);
  return abs;
}

export type LoadedFindings = {
  findings: Finding[];
  noIssues: boolean; // the review explicitly reported nothing
  skippedUnverified: number;
  filteredBelow: number;
};

export function loadFindings(
  markdown: string,
  opts: { includeUnverified?: boolean; minSeverity?: Severity } = {},
): LoadedFindings {
  let findings = parseFindings(markdown);
  const noIssues = findings.length === 0 && reportsNoIssues(markdown);
  let skippedUnverified = 0;
  if (!opts.includeUnverified) {
    skippedUnverified = findings.filter((f) => f.verificationFailed).length;
    findings = findings.filter((f) => !f.verificationFailed);
  }
  let filteredBelow = 0;
  if (opts.minSeverity) {
    const kept = atOrAbove(findings, opts.minSeverity);
    filteredBelow = findings.length - kept.length;
    findings = kept;
  }
  return { findings, noIssues, skippedUnverified, filteredBelow };
}

// Severity gate for CI: verified findings at or above the threshold.
export function gateFindings(markdown: string, threshold: Severity): Finding[] {
  return atOrAbove(loadFindings(markdown).findings, threshold);
}

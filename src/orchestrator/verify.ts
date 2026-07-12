import type { Finding } from '../formatters/findings.js';

// path → ranges of NEW-file lines covered by hunks (context lines included)
export type DiffIndex = Map<string, Array<[number, number]>>;

export function buildDiffIndex(diff: string): DiffIndex {
  const index: DiffIndex = new Map();
  let currentFile: string | null = null;
  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
    if (fileMatch) {
      currentFile = fileMatch[2] ?? fileMatch[1];
      if (!index.has(currentFile)) index.set(currentFile, []);
      continue;
    }
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch && currentFile) {
      const start = Number.parseInt(hunkMatch[1], 10);
      const count = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1;
      index.get(currentFile)!.push([start, Math.max(start, start + count - 1)]);
    }
  }
  return index;
}

function matchDiffPath(index: DiffIndex, findingPath: string): string | undefined {
  if (index.has(findingPath)) return findingPath;
  // Tolerate prefix differences (e.g. judge writes "auth.js" for "src/auth.js")
  for (const diffPath of index.keys()) {
    if (diffPath.endsWith(`/${findingPath}`) || findingPath.endsWith(`/${diffPath}`)) {
      return diffPath;
    }
  }
  return undefined;
}

export type VerificationSplit = {
  verified: Finding[];
  unverified: { finding: Finding; reason: string }[];
};

// Mechanical backstop against judge hallucinations: every finding must point
// at a file that is actually in the diff, and (when it names lines) at lines
// covered by a hunk. Failures are demoted, never silently dropped.
export function verifyFindings(findings: Finding[], diff: string): VerificationSplit {
  const index = buildDiffIndex(diff);
  const verified: Finding[] = [];
  const unverified: { finding: Finding; reason: string }[] = [];

  for (const finding of findings) {
    if (finding.affected.length === 0) {
      unverified.push({ finding, reason: 'no Affected file/line reference' });
      continue;
    }
    let failure: string | null = null;
    for (const affected of finding.affected) {
      const m = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(affected.trim());
      const rawPath = m?.[1]?.trim();
      if (!rawPath) {
        failure = `unparseable Affected entry "${affected}"`;
        break;
      }
      const diffPath = matchDiffPath(index, rawPath);
      if (!diffPath) {
        failure = `${rawPath} is not part of the diff`;
        break;
      }
      if (m?.[2]) {
        const start = Number.parseInt(m[2], 10);
        const end = m[3] ? Number.parseInt(m[3], 10) : start;
        const ranges = index.get(diffPath)!;
        const intersects = ranges.some(([hs, he]) => start <= he && end >= hs);
        if (!intersects) {
          failure = `${rawPath}:${start}${m[3] ? `-${end}` : ''} is outside the changed hunks`;
          break;
        }
      }
    }
    if (failure) unverified.push({ finding, reason: failure });
    else verified.push(finding);
  }
  return { verified, unverified };
}

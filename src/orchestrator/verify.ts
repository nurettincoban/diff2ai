import { parseAffected, type Finding } from '../formatters/findings.js';
import { buildDiffIndex, type DiffIndex } from '../git/diffParse.js';

export { buildDiffIndex, type DiffIndex };

export function matchDiffPath(index: DiffIndex, findingPath: string): string | undefined {
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
      const ref = parseAffected(affected);
      const rawPath = ref?.path;
      if (!ref || !rawPath) {
        failure = `unparseable Affected entry "${affected}"`;
        break;
      }
      const diffPath = matchDiffPath(index, rawPath);
      if (!diffPath) {
        failure = `${rawPath} is not part of the diff`;
        break;
      }
      if (ref.start !== undefined) {
        const start = ref.start;
        const end = ref.end ?? start;
        const ranges = index.get(diffPath)!;
        const intersects = ranges.some(([hs, he]) => start <= he && end >= hs);
        if (!intersects) {
          failure = `${rawPath}:${start}${end !== start ? `-${end}` : ''} is outside the changed hunks`;
          break;
        }
      }
    }
    if (failure) unverified.push({ finding, reason: failure });
    else verified.push(finding);
  }
  return { verified, unverified };
}

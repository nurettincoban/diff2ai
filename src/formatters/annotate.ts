import { walkDiff } from '../git/diffParse.js';

// Prefixes every hunk line with its line number in the NEW version of the
// file, so a reviewer that only sees the diff (e.g. a web chat) can cite
// accurate `path:line` locations without counting from the @@ headers.
// Removed lines get a blank number column. File and hunk headers are kept
// verbatim, so the result still splits per file/hunk like a normal diff.
//
//   @@ -10,3 +10,4 @@ function foo()
//     10  const a = 1;
//     11 +const b = 2;
//        -const c = 3;
export function annotateLineNumbers(diff: string): string {
  let maxLine = 0;
  walkDiff(diff, (_line, _kind, info) => {
    if (info.newLine !== undefined && info.newLine > maxLine) maxLine = info.newLine;
  });
  if (maxLine === 0) return diff;
  const width = Math.max(4, String(maxLine).length);
  const blank = ' '.repeat(width);

  const out: string[] = [];
  walkDiff(diff, (line, kind, info) => {
    switch (kind) {
      case 'add':
      case 'context':
        out.push(`${String(info.newLine).padStart(width)} ${line}`);
        break;
      case 'del':
      case 'meta':
        out.push(`${blank} ${line}`);
        break;
      default:
        out.push(line);
    }
  });
  return out.join('\n');
}

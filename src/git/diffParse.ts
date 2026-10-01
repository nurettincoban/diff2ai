// Helpers for reading the unified diffs produced by `git diff` / `git show`.
// Every module that needs file paths, hunks or stats from a diff goes through
// here, so quoting and path edge cases are handled in one place.

const HEADER_PREFIX = 'diff --git ';
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export type DiffGitHeader = { oldPath: string; newPath: string };

// Splits a diff into per-file sections, each starting with its `diff --git`
// line. Text before the first header (e.g. commit metadata from `git show`)
// becomes a leading section. Concatenating the sections reproduces the input.
export function splitFileSections(diff: string): string[] {
  return diff.split(/(?=^diff --git )/m).filter((s) => s.length > 0);
}

// Git C-quotes paths containing special characters: "a/caf\303\251 \"x\".txt"
function unquote(quoted: string): string {
  const bytes: number[] = [];
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  };
  for (let i = 0; i < quoted.length; i++) {
    const ch = quoted[i];
    if (ch !== '\\') {
      bytes.push(...Buffer.from(ch, 'utf-8'));
      continue;
    }
    const next = quoted[i + 1];
    if (next !== undefined && /[0-7]/.test(next)) {
      const octal = quoted.slice(i + 1, i + 4);
      bytes.push(Number.parseInt(octal, 8));
      i += 3;
    } else if (next !== undefined && next in escapes) {
      bytes.push(escapes[next]);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString('utf-8');
}

// Reads one path token (quoted or bare) starting at `from`. Bare tokens run to
// the end of the string; the caller splits ambiguous bare pairs.
function readQuoted(s: string, from: number): { value: string; end: number } | null {
  if (s[from] !== '"') return null;
  for (let i = from + 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '"') return { value: unquote(s.slice(from + 1, i)), end: i + 1 };
  }
  return null;
}

function stripPrefix(p: string, prefix: 'a/' | 'b/'): string {
  return p.startsWith(prefix) ? p.slice(2) : p;
}

export function parseDiffGitHeader(rawLine: string): DiffGitHeader | null {
  const line = rawLine.replace(/\r$/, '');
  if (!line.startsWith(HEADER_PREFIX)) return null;
  const rest = line.slice(HEADER_PREFIX.length);

  // Quoted old path: "a/..." followed by quoted or bare new path
  const oldQuoted = readQuoted(rest, 0);
  if (oldQuoted) {
    const tail = rest.slice(oldQuoted.end + 1);
    const newQuoted = readQuoted(tail, 0);
    const newPath = newQuoted ? newQuoted.value : tail;
    return { oldPath: stripPrefix(oldQuoted.value, 'a/'), newPath: stripPrefix(newPath, 'b/') };
  }

  // Bare old path with quoted new path: a/x "b/y"
  const quotedNewAt = rest.lastIndexOf(' "b/');
  if (quotedNewAt > 0 && rest.endsWith('"')) {
    const newQuoted = readQuoted(rest, quotedNewAt + 1);
    if (newQuoted) {
      return {
        oldPath: stripPrefix(rest.slice(0, quotedNewAt), 'a/'),
        newPath: stripPrefix(newQuoted.value, 'b/'),
      };
    }
  }

  // Bare paths may contain spaces. Unrenamed files have identical halves
  // ("a/X b/X"), which disambiguates paths like "a/my b/file.txt b/my b/file.txt".
  if (rest.startsWith('a/')) {
    const n = (rest.length - 5) / 2;
    if (Number.isInteger(n) && n > 0) {
      const left = rest.slice(2, 2 + n);
      if (rest.slice(2 + n, 5 + n) === ' b/' && rest.slice(5 + n) === left) {
        return { oldPath: left, newPath: left };
      }
    }
  }

  const m = /^a\/(.*?) b\/(.*)$/.exec(rest);
  if (m) return { oldPath: m[1], newPath: m[2] };
  return null;
}

// Path (new side) of a file section, or null for a non-file preamble.
export function sectionPath(section: string): string | null {
  const firstLine = section.slice(
    0,
    section.indexOf('\n') >= 0 ? section.indexOf('\n') : undefined,
  );
  return parseDiffGitHeader(firstLine)?.newPath ?? null;
}

export function changedFiles(diff: string): string[] {
  const files: string[] = [];
  for (const section of splitFileSections(diff)) {
    const p = sectionPath(section);
    if (p) files.push(p);
  }
  return files;
}

export type HunkHeader = { oldStart: number; oldCount: number; newStart: number; newCount: number };

export function parseHunkHeader(rawLine: string): HunkHeader | null {
  const m = HUNK_HEADER.exec(rawLine);
  if (!m) return null;
  return {
    oldStart: Number.parseInt(m[1], 10),
    oldCount: m[2] === undefined ? 1 : Number.parseInt(m[2], 10),
    newStart: Number.parseInt(m[3], 10),
    newCount: m[4] === undefined ? 1 : Number.parseInt(m[4], 10),
  };
}

export type LineKind = 'header' | 'hunk' | 'add' | 'del' | 'context' | 'meta';

// Walks a diff line by line, classifying each line. Hunk bodies are tracked
// with the counts from the @@ header, so a removed line that itself starts
// with "--" or an added "++" line is never mistaken for a file header.
export function walkDiff(
  diff: string,
  visit: (line: string, kind: LineKind, info: { file: string | null; newLine?: number }) => void,
): void {
  let file: string | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let newLine = 0;
  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const marker = line[0];
      if (marker === '+') {
        visit(line, 'add', { file, newLine });
        newLine++;
        newLeft--;
        continue;
      }
      if (marker === '-') {
        visit(line, 'del', { file });
        oldLeft--;
        continue;
      }
      if (marker === ' ' || line === '' || line === '\r') {
        visit(line, 'context', { file, newLine });
        newLine++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (marker === '\\') {
        visit(line, 'meta', { file });
        continue;
      }
      // Malformed or truncated hunk: fall through and resync on headers.
      oldLeft = 0;
      newLeft = 0;
    }
    const header = parseDiffGitHeader(line);
    if (header) {
      file = header.newPath;
      visit(line, 'header', { file });
      continue;
    }
    const hunk = parseHunkHeader(line);
    if (hunk && file !== null) {
      oldLeft = hunk.oldCount;
      newLeft = hunk.newCount;
      newLine = hunk.newStart;
      visit(line, 'hunk', { file });
      continue;
    }
    if (line[0] === '\\' && file !== null) {
      visit(line, 'meta', { file });
      continue;
    }
    visit(line, 'header', { file });
  }
}

// path → ranges of NEW-file lines covered by hunks (context lines included)
export type DiffIndex = Map<string, Array<[number, number]>>;

export function buildDiffIndex(diff: string): DiffIndex {
  const index: DiffIndex = new Map();
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const header = parseDiffGitHeader(line);
    if (header) {
      file = header.newPath;
      if (!index.has(file)) index.set(file, []);
      continue;
    }
    const hunk = parseHunkHeader(line);
    if (hunk && file !== null) {
      const end = Math.max(hunk.newStart, hunk.newStart + hunk.newCount - 1);
      index.get(file)!.push([hunk.newStart, end]);
    }
  }
  return index;
}

export type FileStatus = 'added' | 'deleted' | 'renamed' | 'modified' | 'binary';

export type FileStat = {
  path: string;
  oldPath?: string; // set for renames
  status: FileStatus;
  added: number;
  removed: number;
};

export function diffFileStats(diff: string): FileStat[] {
  const stats: FileStat[] = [];
  for (const section of splitFileSections(diff)) {
    const firstLine = section.split('\n', 1)[0];
    const header = parseDiffGitHeader(firstLine);
    if (!header) continue;
    let status: FileStatus = 'modified';
    if (/^new file mode /m.test(section)) status = 'added';
    else if (/^deleted file mode /m.test(section)) status = 'deleted';
    else if (/^rename from /m.test(section)) status = 'renamed';
    if (/^(Binary files .* differ|GIT binary patch)$/m.test(section)) status = 'binary';

    let added = 0;
    let removed = 0;
    walkDiff(section, (_line, kind) => {
      if (kind === 'add') added++;
      else if (kind === 'del') removed++;
    });
    stats.push({
      path: header.newPath,
      oldPath: status === 'renamed' ? header.oldPath : undefined,
      status,
      added,
      removed,
    });
  }
  return stats;
}

export function formatFileStats(stats: FileStat[]): string {
  if (stats.length === 0) return '(no files)';
  const lines = stats.map((s) => {
    const counts = `+${s.added}/-${s.removed}`;
    switch (s.status) {
      case 'added':
        return `- ${s.path} (new file, ${counts})`;
      case 'deleted':
        return `- ${s.path} (deleted, ${counts})`;
      case 'renamed':
        return `- ${s.path} (renamed from ${s.oldPath}, ${counts})`;
      case 'binary':
        return `- ${s.path} (binary)`;
      default:
        return `- ${s.path} (${counts})`;
    }
  });
  const totalAdded = stats.reduce((n, s) => n + s.added, 0);
  const totalRemoved = stats.reduce((n, s) => n + s.removed, 0);
  lines.push(`Total: ${stats.length} file(s), +${totalAdded}/-${totalRemoved}`);
  return lines.join('\n');
}

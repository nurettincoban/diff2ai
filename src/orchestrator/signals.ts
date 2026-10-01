import { BUILTIN_PERSONAS } from './personas.js';
import { changedFiles, walkDiff } from '../git/diffParse.js';

export type PersonaSuggestion = { slug: string; reason: string };

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)(\/|$)|\.(test|spec|it)\.[a-z]+$/i;
const SECURITY_PATH =
  /auth|security|login|session|token|password|secret|crypt|acl|permission|migrations?|\.sql$/i;
const SECURITY_CONTENT =
  /password|secret|api[_-]?key|jwt|bearer\s|eval\(|exec\(|innerHTML|dangerouslySetInnerHTML|SELECT\s+.+\s+FROM|INSERT\s+INTO/i;
const PERF_PATH = /queue|worker|jobs?|batch|cache|cron|scheduler|database|repositor|\.sql$/i;
const PERF_CONTENT = /Promise\.all|setInterval|createIndex|N\+1/i;
const API_PATH =
  /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|schemas?|contracts?)(\/|\.|$)|openapi|swagger|\.proto$|\.d\.ts$/i;

export { changedFiles };

function addedLines(diff: string): string[] {
  const lines: string[] = [];
  walkDiff(diff, (line, kind) => {
    if (kind === 'add') lines.push(line);
  });
  return lines;
}

// Local, zero-token heuristics: suggest reviewer personas from what the diff
// actually touches. Suggestions preselect the interactive picker and drive
// --personas auto; they never bypass user approval of the run.
export function suggestPersonas(diff: string): PersonaSuggestion[] {
  const files = changedFiles(diff);
  const added = addedLines(diff).join('\n');
  const testFiles = files.filter((f) => TEST_PATH.test(f));
  const sourceFiles = files.filter((f) => !TEST_PATH.test(f));

  const suggestions: PersonaSuggestion[] = [
    { slug: 'correctness', reason: 'baseline bug hunt on every review' },
  ];

  const securityFile = files.find((f) => SECURITY_PATH.test(f));
  if (securityFile) {
    suggestions.push({ slug: 'security', reason: `touches ${securityFile}` });
  } else if (SECURITY_CONTENT.test(added)) {
    suggestions.push({ slug: 'security', reason: 'added code handles secrets/SQL/auth material' });
  }

  if (testFiles.length === 0 && sourceFiles.length > 0) {
    suggestions.push({
      slug: 'testing-edge-cases',
      reason: 'no test changes accompany the code changes',
    });
  } else if (sourceFiles.length === 0 && testFiles.length > 0) {
    suggestions.push({ slug: 'testing-edge-cases', reason: 'only test files changed' });
  }

  const apiFile = sourceFiles.find((f) => API_PATH.test(f));
  if (apiFile) {
    suggestions.push({ slug: 'api-maintainability', reason: `touches ${apiFile}` });
  }

  const perfFile = files.find((f) => PERF_PATH.test(f));
  if (perfFile) {
    suggestions.push({ slug: 'performance', reason: `touches ${perfFile}` });
  } else if (PERF_CONTENT.test(added)) {
    suggestions.push({
      slug: 'performance',
      reason: 'added code has concurrency/caching patterns',
    });
  }

  // A consensus needs at least two reviewers: pad from the default order.
  for (const p of BUILTIN_PERSONAS) {
    if (suggestions.length >= 2) break;
    if (!suggestions.some((s) => s.slug === p.slug)) {
      suggestions.push({ slug: p.slug, reason: 'default second reviewer' });
    }
  }
  return suggestions;
}

// Suggestion-first ordering, padded with the remaining pool up to `n`.
export function topNPersonaSlugs(
  suggestions: PersonaSuggestion[],
  n: number,
  poolSlugs: string[],
): string[] {
  const ordered = [
    ...suggestions.map((s) => s.slug),
    ...poolSlugs.filter((slug) => !suggestions.some((s) => s.slug === slug)),
  ];
  return ordered.slice(0, n);
}

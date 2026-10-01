import { runCommandCapture } from '../runners/execute.js';
import type { Finding } from '../formatters/findings.js';
import { formatSummaryComment } from './format.js';

export type GitlabConfig = {
  command?: string; // defaults to "glab"; overridable for tests/wrappers
  args?: string[]; // always prepended
};

// Renders findings as a single GitLab-flavored-markdown MR note.
export function formatMrComment(findings: Finding[], opts: { source?: string } = {}): string {
  return formatSummaryComment(findings, opts);
}

export type PostResult = { ok: true; output: string } | { ok: false; error: string };

// Windows caps a command line at ~32k characters; longer notes go via stdin.
const MAX_ARGV_BODY = 24_000;

// Posts a note on a GitLab MR via the user's authenticated glab CLI.
// diff2ai itself makes no network calls — glab owns auth and transport.
export async function postMrNote(
  body: string,
  opts: { mr?: string; gitlab?: GitlabConfig } = {},
): Promise<PostResult> {
  const command = opts.gitlab?.command ?? 'glab';
  const baseArgs = Array.isArray(opts.gitlab?.args) ? opts.gitlab.args : [];
  const viaStdin = body.length > MAX_ARGV_BODY;
  // `glab mr note create` reads the message from stdin
  const args = [...baseArgs, 'mr', 'note', ...(viaStdin ? ['create'] : [])];
  if (opts.mr) args.push(opts.mr);
  if (!viaStdin) args.push('--message', body);

  const res = await runCommandCapture(command, args, viaStdin ? { input: body } : {});
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

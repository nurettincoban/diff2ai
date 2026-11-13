import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { costUsd } from './cost.js';
import type { Price } from './types.js';

// Local pass-through for the benchmark judge's LLM calls. The benchmark's
// pipeline logs no token usage, so requests go through here: the body is
// forwarded byte for byte, and only the response's `usage` numbers are
// recorded. Headers (which carry the API key) and bodies are never logged.

export type JudgeCall = {
  ts: string;
  kind: 'extract' | 'dedup' | 'judge' | 'other';
  pr: string | null;
  status: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type ChatRequest = { model?: string; messages?: { role: string; content: unknown }[] };
export type Upstream = (
  path: string,
  body: Buffer,
  headers: Record<string, string>,
) => Promise<{
  status: number;
  text: string;
}>;

export type Needle = { kind: JudgeCall['kind']; text: string; pr: string };

export type ProxyOptions = {
  upstream: Upstream;
  logFile: string;
  price: Price;
  capUsd: number; // Infinity disables the cap
  // Text known to belong to one PR, per call kind: golden comments identify
  // judge calls, posted comment bodies identify extraction calls. Dedup calls
  // are matched on the issue strings learned from extraction responses.
  needles: Needle[];
  onCap: () => void;
};

const SKIP_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding']);

// Forwards to a real OpenAI-compatible endpoint, e.g. https://api.anthropic.com/v1/
export function httpUpstream(baseUrl: string): Upstream {
  const base = baseUrl.replace(/\/+$/, '');
  return async (path, body, headers) => {
    const res = await fetch(base + path, { method: 'POST', headers, body: new Uint8Array(body) });
    return { status: res.status, text: await res.text() };
  };
}

function kindOf(req: ChatRequest): JudgeCall['kind'] {
  const system = String(req.messages?.find((m) => m.role === 'system')?.content ?? '');
  if (system.includes('extract code review issues')) return 'extract';
  if (system.includes('group duplicate code review comments')) return 'dedup';
  if (system.includes('code review evaluator')) return 'judge';
  return 'other';
}

function contentOf(text: string): string {
  try {
    const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  } catch {
    return '';
  }
}

// Issue strings from an extraction response, so later dedup calls (which only
// contain those strings) can be attributed to the same PR.
function extractedIssues(content: string): string[] {
  const json = /\{[\s\S]*\}/.exec(content)?.[0];
  if (!json) return [];
  try {
    const issues = (JSON.parse(json) as { issues?: unknown }).issues;
    return Array.isArray(issues) ? issues.filter((i): i is string => typeof i === 'string') : [];
  } catch {
    return [];
  }
}

export async function startProxy(o: ProxyOptions) {
  const needles = [...o.needles];
  const calls: JudgeCall[] = [];
  let spent = 0;
  let tripped = false;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const send = (status: number, text: string) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(text);
      };
      if (tripped) {
        send(400, JSON.stringify({ error: { message: 'eval cost cap reached' } }));
        return;
      }
      const body = Buffer.concat(chunks);
      let parsed: ChatRequest = {};
      try {
        parsed = JSON.parse(body.toString('utf-8')) as ChatRequest;
      } catch {
        // forwarded as is; the upstream reports the problem
      }
      const user = String(parsed.messages?.find((m) => m.role === 'user')?.content ?? '');
      const kind = kindOf(parsed);
      const pr = needles.find((n) => n.kind === kind && user.includes(n.text))?.pr ?? null;
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string' && !SKIP_HEADERS.has(name)) headers[name] = value;
      }
      // "/v1/chat/completions" on the proxy maps to "<base>/chat/completions"
      const path = (req.url ?? '').replace(/^\/v1/, '');
      let out: { status: number; text: string };
      try {
        out = await o.upstream(path, body, headers);
      } catch (error) {
        out = { status: 502, text: JSON.stringify({ error: { message: String(error) } }) };
      }
      let usage = { prompt_tokens: 0, completion_tokens: 0 };
      try {
        usage = { ...usage, ...(JSON.parse(out.text) as { usage?: typeof usage }).usage };
      } catch {
        // non-JSON error body: nothing to count
      }
      const call: JudgeCall = {
        ts: new Date().toISOString(),
        kind,
        pr,
        status: out.status,
        model: parsed.model ?? null,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
      };
      calls.push(call);
      fs.appendFileSync(o.logFile, JSON.stringify(call) + '\n');
      if (kind === 'extract' && pr) {
        for (const issue of extractedIssues(contentOf(out.text)))
          needles.push({ kind: 'dedup', text: issue, pr });
      }
      spent += costUsd(call, o.price);
      if (spent > o.capUsd && !tripped) {
        tripped = true;
        o.onCap();
      }
      send(out.status, out.text);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    calls,
    spentUsd: () => spent,
    capReached: () => tripped,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function usageByPr(calls: JudgeCall[], price: Price) {
  const out = new Map<
    string,
    { calls: number; inputTokens: number; outputTokens: number; costUsd: number }
  >();
  for (const c of calls) {
    const key = c.pr ?? '(unattributed)';
    const cur = out.get(key) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    cur.calls += 1;
    cur.inputTokens += c.inputTokens;
    cur.outputTokens += c.outputTokens;
    cur.costUsd += costUsd(c, price);
    out.set(key, cur);
  }
  return out;
}

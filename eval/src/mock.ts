import type { ChatRequest, Upstream } from './proxy.js';

// Stand-in for the judge's LLM endpoint, used by `--mock` runs and tests.
// It answers the benchmark pipeline's three prompt types deterministically,
// so the whole harness can be exercised with no provider call. Its "verdicts"
// mean nothing and mock runs are never written to eval/results/.
export const mockUpstream: Upstream = async (_path, body) => {
  const req = JSON.parse(body.toString('utf-8')) as ChatRequest;
  const system = String(req.messages?.find((m) => m.role === 'system')?.content ?? '');
  const user = String(req.messages?.find((m) => m.role === 'user')?.content ?? '');
  let answer: unknown;
  if (system.includes('extract code review issues')) {
    // Titles of diff2ai inline comments: "**<badge>** · <type> — **<title>**"
    const comment = user.split('Code Review Comment:')[1]?.split('Instructions:')[0] ?? '';
    answer = { issues: [...comment.matchAll(/— \*\*(.+?)\*\*/g)].map((m) => m[1]) };
  } else if (system.includes('group duplicate code review comments')) {
    const list = user.split('Candidates:')[1]?.split('Return ONLY')[0] ?? '';
    const n = list.split('\n').filter((l) => /^\d+\. /.test(l)).length;
    answer = { groups: Array.from({ length: n }, (_, i) => [i]) };
  } else {
    const golden = user.split('Golden Comment')[1]?.split('Candidate Issue')[0] ?? '';
    const candidate = user.split('Candidate Issue')[1]?.split('Instructions:')[0] ?? '';
    const match = candidate.includes('Shared') && golden.length % 2 === 0;
    answer = { reasoning: 'mock verdict', match, confidence: match ? 0.9 : 0.1 };
  }
  return {
    status: 200,
    text: JSON.stringify({
      id: 'mock',
      object: 'chat.completion',
      created: 0,
      model: req.model ?? 'mock',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(answer) },
        },
      ],
      usage: { prompt_tokens: Math.ceil(user.length / 4), completion_tokens: 20, total_tokens: 0 },
    }),
  };
};

#!/usr/bin/env node
// Eval-only diff2ai runner: reads the review prompt on stdin, sends it to the
// Claude API as a single user message, prints the model's text to stdout.
//
// It exists so an evaluation run has a pinned model ID and exact token usage,
// neither of which a CLI runner in text mode reports. Credentials come from
// the environment (ANTHROPIC_API_KEY); nothing here reads or prints them.
//
//   node anthropic-runner.mjs --model <id> [--effort <level>] [--max-tokens <n>]
//
// DIFF2AI_EVAL_USAGE_FILE  append one JSON line per call (model, tokens, stop reason)
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

function fail(message) {
  console.error(`anthropic-runner: ${message}`);
  process.exit(1);
}

const model = arg('--model');
const effort = arg('--effort', '');
const maxTokens = Number.parseInt(arg('--max-tokens', '64000'), 10);
if (!model) fail('--model is required');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const prompt = Buffer.concat(chunks).toString('utf-8');
if (prompt.trim().length === 0) fail('empty prompt on stdin');

const started = Date.now();
let message;
try {
  const client = new Anthropic();
  // Streaming keeps long generations clear of HTTP timeouts. No fallback model
  // is configured on purpose: a review must come from the pinned model or fail.
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    ...(effort ? { output_config: { effort } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });
  message = await stream.finalMessage();
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    fail('authentication failed: set ANTHROPIC_API_KEY to a valid key');
  } else if (error instanceof Anthropic.RateLimitError) {
    fail('rate limited after retries');
  } else if (error instanceof Anthropic.APIError) {
    fail(`API error ${error.status}: ${error.message}`);
  }
  fail(error instanceof Error ? error.message : String(error));
}

const usage = message.usage;
if (process.env.DIFF2AI_EVAL_USAGE_FILE) {
  fs.appendFileSync(
    process.env.DIFF2AI_EVAL_USAGE_FILE,
    JSON.stringify({
      id: message.id,
      model: message.model,
      requestedModel: model,
      effort: effort || null,
      stopReason: message.stop_reason,
      // Billed input is the uncached count plus cache writes and reads (none are requested here)
      inputTokens:
        usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0),
      outputTokens: usage.output_tokens,
      ms: Date.now() - started,
    }) + '\n',
  );
}

if (message.stop_reason === 'refusal') {
  fail(`the model declined the request (category: ${message.stop_details?.category ?? 'unknown'})`);
}
if (message.stop_reason === 'max_tokens') {
  fail(`output was cut off at max_tokens=${maxTokens}`);
}

const text = message.content
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('');
process.stdout.write(text.endsWith('\n') ? text : text + '\n');

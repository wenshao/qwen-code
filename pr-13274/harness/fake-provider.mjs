// Scripted OpenAI-compatible provider for PR #13274 verification.
//
// Main-session requests: first turn -> `workflow` tool call carrying the
// scenario script; once a tool result is present -> final text.
// Workflow child requests (identified by the workflow subagent system prompt
// and a CHILD_<X> marker in the prompt) follow a per-child action list:
//   {type:'429', retryAfter:'2'}  HTTP 429 + Retry-After header
//   {type:'hang'}                 accept the request, never answer
//   {type:'ok', text}             normal SSE answer
//   {type:'stream429'}            200 SSE carrying an error_finish throttle
// Every request is appended to $FAKE_LOG as one JSON line.
import { createServer } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';

const scenario = JSON.parse(readFileSync(process.env.FAKE_SCENARIO, 'utf8'));
const LOG = process.env.FAKE_LOG;
const t0 = Date.now();
const childCounters = new Map();
let mainCount = 0;
let seq = 0;

const log = (rec) =>
  appendFileSync(LOG, JSON.stringify({ t: Date.now() - t0, at: Date.now(), ...rec }) + '\n');

const textOf = (m) =>
  typeof m?.content === 'string'
    ? m.content
    : Array.isArray(m?.content)
      ? m.content.map((p) => p?.text ?? '').join('\n')
      : '';

function sse(res, chunks) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

const chunk = (delta, finish = null, extra = {}) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: 'fake-model',
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});

const usage = {
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

function answerText(res, text) {
  sse(res, [
    chunk({ role: 'assistant', content: text }),
    chunk({}, 'stop'),
    { ...chunk({}, null), choices: [], ...usage },
  ]);
}

function answerToolCall(res, name, args) {
  sse(res, [
    chunk({
      role: 'assistant',
      tool_calls: [
        {
          index: 0,
          id: 'call_wf_1',
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
    chunk({}, 'tool_calls'),
    { ...chunk({}, null), choices: [], ...usage },
  ]);
}

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const id = ++seq;
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {}
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const system = msgs.filter((m) => m.role === 'system').map(textOf).join('\n');
    const allText = msgs.map(textOf).join('\n');

    if (body.stream !== true) {
      log({ id, kind: 'side', path: req.url });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'side',
          object: 'chat.completion',
          created: 0,
          model: 'fake-model',
          choices: [
            { index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' },
          ],
          ...usage,
        }),
      );
      return;
    }

    const firstUser = textOf(msgs.find((m) => m.role === 'user'));
    const childMatch = firstUser.match(/CHILD_([A-Z])/);
    if (childMatch) {
      const child = childMatch[1];
      const n = childCounters.get(child) ?? 0;
      childCounters.set(child, n + 1);
      const list = scenario.children[child] ?? [{ type: 'ok', text: 'DEFAULT' }];
      const action = list[Math.min(n, list.length - 1)];
      const rec = { id, kind: 'child', child, n: n + 1, action: action.type };
      if (action.type === '429') {
        log({ ...rec, status: 429, retryAfter: action.retryAfter });
        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': String(action.retryAfter),
        });
        res.end(
          JSON.stringify({
            error: {
              message: 'Rate limit reached, please retry later',
              type: 'rate_limit_error',
              code: 'rate_limit_exceeded',
            },
          }),
        );
        return;
      }
      if (action.type === 'stream429') {
        log({ ...rec, status: 200, streamError: 'error_finish 429' });
        sse(res, [
          chunk(
            { role: 'assistant', content: '{"error":{"code":"429","message":"Throttling: TPM(1/1)"}}' },
            'error_finish',
          ),
        ]);
        return;
      }
      if (action.type === 'hang') {
        const start = Date.now();
        log({ ...rec, status: 'hang' });
        res.on('close', () =>
          log({ id, kind: 'child-abort', child, n: n + 1, abortedAfterMs: Date.now() - start }),
        );
        return; // never answer
      }
      log({ ...rec, status: 200 });
      answerText(res, action.text ?? `ANSWER_${child}`);
      return;
    }

    // Main session.
    mainCount += 1;
    const mainAction = (scenario.main ?? [])[mainCount - 1];
    if (mainAction?.type === '429') {
      log({ id, kind: 'main', n: mainCount, phase: 'main-429', status: 429 });
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(mainAction.retryAfter) });
      res.end(JSON.stringify({ error: { message: 'Rate limit reached', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }));
      return;
    }
    if (scenario.main && !mainAction) {
      log({ id, kind: 'main', n: mainCount, phase: 'main-extra', lastUser: textOf([...msgs].reverse().find((m) => m.role === 'user')).slice(0, 160) });
      answerText(res, 'MAIN_EXTRA');
      return;
    }
    if (mainAction?.type === 'text') {
      log({ id, kind: 'main', n: mainCount, phase: 'main-text' });
      answerText(res, mainAction.text);
      return;
    }
    const toolMsg = msgs.find((m) => m.role === 'tool');
    if (toolMsg) {
      log({ id, kind: 'main', n: mainCount, phase: 'final', toolResult: textOf(toolMsg), lastUser: textOf([...msgs].reverse().find((m) => m.role === 'user')).slice(0, 160) });
      answerText(res, 'MAIN_DONE');
      return;
    }
    log({ id, kind: 'main', n: mainCount, phase: 'workflow-call' });
    if (scenario.agentTool) answerToolCall(res, 'agent', scenario.agentTool);
    else answerToolCall(res, 'workflow', { script: scenario.script });
  });
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  process.stdout.write(`FAKE_READY http://127.0.0.1:${port}/v1\n`);
});

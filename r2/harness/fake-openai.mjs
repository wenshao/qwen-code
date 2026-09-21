// Deterministic OpenAI-compatible server for PR #12234 real-daemon verification.
// The reply is a pure function of the last user message, so the persisted
// transcript is fully predictable and every needle has a known location.
import http from 'node:http';

const port = Number(process.argv[2] ?? 18234);

export function replyFor(userText) {
  const m = /#(\d+)\b/.exec(userText);
  const n = m ? Number(m[1]) : -1;
  const lines = [`Answer #${n}: common-token acknowledged for item ${n}.`];
  if (n === 3) {
    lines.push(
      'The archived identifier is ZEBRA-QUARTZ-7731 and it only lives in this old reply.',
      '',
      '```ts',
      'const retryBudget_dX = computeBackoff(attempt ** 2); // code-needle-0xC0FFEE',
      '```',
    );
  }
  if (n === 5) {
    lines.push('量子纠缠描述的是关联,退相干描述的是环境导致的相干性丢失;可以参考薛定谔的猫态。');
  }
  if (n === 10 || n === 200) lines.push('DUPLICATE-PAYLOAD-ALPHA appears in two different turns.');
  if (n === 150) lines.push('Regex-looking literal: a+|b(c)*[d]?\\.$^{2} should match literally.');
  if (n === 77) lines.push('MixedCaseToken is spelled with capitals here.');
  if (n >= 0 && n % 2 === 0) lines.push(`Filler paragraph ${n}: ${'lorem ipsum dolor sit amet '.repeat(6)}`);
  return lines.join('\n');
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.method !== 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'dummy', object: 'model' }] }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((x) => x.role === 'user');
    const userText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
          ? lastUser.content.map((p) => p.text ?? '').join('\n')
          : '';
    const system = messages.find((x) => x.role === 'system');
    const sysText = typeof system?.content === 'string' ? system.content : JSON.stringify(system?.content ?? '');
    // Side queries (titles, summaries, classifiers) get a terse generic answer.
    const isMain = /#\d+\b/.test(userText) && !/title|summar/i.test(sysText.slice(0, 400));
    let content = isMain ? replyFor(userText) : 'Synthetic verification session';
    // Tool-call turn: first leg emits text + a read-only tool call, second leg
    // (after the tool result arrives) emits the closing text.
    const lastIdx = messages.lastIndexOf(lastUser);
    const toolDone = messages.slice(lastIdx + 1).some((x) => x.role === 'tool');
    const wantsTool = isMain && /TOOLCALL/.test(userText);
    let toolCalls;
    if (wantsTool && !toolDone) {
      content = 'Let me inspect the workspace first. PRE-TOOL-NEEDLE-ORCHID';
      toolCalls = [{ index: 0, id: 'call_verify_1', type: 'function', function: { name: 'list_directory', arguments: JSON.stringify({ path: '/root/verify/pr12234-r2-harness/ws' }) } }];
    } else if (wantsTool) {
      content = 'The workspace holds a README. POST-TOOL-NEEDLE-ORCHID';
    }
    const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
    const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      const base = { id, object: 'chat.completion.chunk', created: 1, model: body.model ?? 'dummy' };
      send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
      if (toolCalls) send({ ...base, choices: [{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: toolCalls ? 'tool_calls' : 'stop' }] });
      send({ ...base, choices: [], usage });
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created: 1,
          model: body.model ?? 'dummy',
          choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls.map(({ index, ...c }) => c) } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
          usage,
        }),
      );
    }
  });
});
if (process.argv[1]?.endsWith('fake-openai.mjs')) {
  server.listen(port, '127.0.0.1', () => console.log(`FAKE_SERVER_READY http://127.0.0.1:${port}/v1`));
}

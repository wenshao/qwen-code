// Scripted OpenAI-compatible model for the PR 12840 rig.
// Default: two reasoning chunks, three text chunks, usage.
// Prompt keywords:
//   INTERLEAVE  reasoning, text, reasoning, text (four Parts in one Item)
//   BIG <n>     n text chunks of ~1.5 KB each, 2 ms apart (hub overflow)
//   SLOW <n>    n text chunks 400 ms apart (a Turn that runs for a while)
//   FAIL        HTTP 400 (failed Turn)
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 33849);
const log = process.argv[3] ?? 'model-requests.jsonl';
let count = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let request = {};
    try {
      request = JSON.parse(body || '{}');
    } catch {}
    const n = ++count;
    const last = [...(request.messages ?? [])].reverse().find((m) => m.role === 'user');
    const parts =
      typeof last?.content === 'string' ? [last.content] : (last?.content ?? []).map((p) => p.text ?? '');
    const prompt = parts.filter((t) => !t.startsWith('<system-reminder>')).pop() ?? '';
    fs.appendFileSync(
      log,
      JSON.stringify({ n, at: new Date().toISOString(), stream: !!request.stream, prompt: prompt.slice(0, 120) }) + '\n',
    );
    if (!request.stream) {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: `fake-${n}`,
          object: 'chat.completion',
          created: 0,
          model: request.model,
          choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }),
      );
      return;
    }
    if (prompt.includes('FAIL')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'rig model rejected the request', type: 'invalid_request_error' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const chunk = (delta, finish = null) =>
      res.write(
        'data: ' +
          JSON.stringify({ id: `fake-${n}`, object: 'chat.completion.chunk', created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] }) +
          '\n\n',
      );
    const finish = () => {
      chunk({}, 'stop');
      res.write(
        'data: ' +
          JSON.stringify({ id: `fake-${n}`, object: 'chat.completion.chunk', created: 0, model: request.model, choices: [], usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 } }) +
          '\n\n',
      );
      res.end('data: [DONE]\n\n');
    };
    const echo = prompt.slice(0, 60).replace(/\s+/g, ' ');
    let steps;
    let delay = 120;
    const big = /BIG (\d+)/.exec(prompt);
    const slow = /SLOW (\d+)/.exec(prompt);
    if (big) {
      delay = 2;
      const k = Number(big[1]);
      steps = [() => chunk({ role: 'assistant', content: `REPLY_${n}: big ` })];
      for (let i = 1; i <= k; i++) steps.push(() => chunk({ content: `[${i}]` + 'x'.repeat(1500) }));
      steps.push(finish);
    } else if (slow) {
      delay = 400;
      const k = Number(slow[1]);
      steps = [() => chunk({ role: 'assistant', content: `REPLY_${n}: slow ` })];
      for (let i = 1; i <= k; i++) steps.push(() => chunk({ content: `s${i} ` }));
      steps.push(finish);
    } else if (prompt.includes('INTERLEAVE')) {
      steps = [
        () => chunk({ role: 'assistant', reasoning_content: 'First thought. ' }),
        () => chunk({ reasoning_content: 'Still thinking.' }),
        () => chunk({ content: `REPLY_${n}: part one, ` }),
        () => chunk({ content: 'still part one. ' }),
        () => chunk({ reasoning_content: 'Second thought.' }),
        () => chunk({ content: 'Part two ' }),
        () => chunk({ content: `answered "${echo}".` }),
        finish,
      ];
    } else {
      steps = [
        () => chunk({ role: 'assistant', reasoning_content: 'Reading the request. ' }),
        () => chunk({ reasoning_content: 'Planning a short answer.' }),
        () => chunk({ content: `REPLY_${n}: ` }),
        () => chunk({ content: 'the event replay rig ' }),
        () => chunk({ content: `answered "${echo}".` }),
        finish,
      ];
    }
    let i = 0;
    const next = () => {
      if (res.destroyed) return;
      steps[i++]();
      if (i < steps.length) setTimeout(next, delay);
    };
    next();
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake model listening ${port}`));

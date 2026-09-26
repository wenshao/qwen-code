// Scripted OpenAI-compatible model for the PR 12808 rig.
// Streams reasoning + text in several chunks, then usage.
// A prompt containing HOLD keeps the stream open until the client aborts
// (cancel path); a prompt containing FAIL answers HTTP 500 (failed Turn).
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 33809);
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
      JSON.stringify({ n, at: new Date().toISOString(), stream: !!request.stream, model: request.model, tools: (request.tools ?? []).length, prompt: prompt.slice(0, 200) }) + '\n',
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
    if (prompt.includes('HOLD')) {
      chunk({ role: 'assistant', content: 'Holding until cancelled… ' });
      const timer = setInterval(() => !res.destroyed && chunk({ content: '.' }), 500);
      res.on('close', () => clearInterval(timer));
      return;
    }
    const steps = [
      () => chunk({ role: 'assistant', reasoning_content: 'Reading the request. ' }),
      () => chunk({ reasoning_content: 'Planning a short answer.' }),
      () => chunk({ content: `REPLY_${n}: ` }),
      () => chunk({ content: 'the Managed Agent contract rig ' }),
      () => chunk({ content: `answered "${prompt.slice(0, 60).replace(/\s+/g, ' ')}".` }),
      () => chunk({}, 'stop'),
      () => {
        res.write(
          'data: ' +
            JSON.stringify({ id: `fake-${n}`, object: 'chat.completion.chunk', created: 0, model: request.model, choices: [], usage: { prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 } }) +
            '\n\n',
        );
        res.end('data: [DONE]\n\n');
      },
    ];
    let i = 0;
    const next = () => {
      if (res.destroyed) return;
      steps[i++]();
      if (i < steps.length) setTimeout(next, 120);
    };
    next();
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake model listening ${port}`));

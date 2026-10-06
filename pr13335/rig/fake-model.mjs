// pr13335 rig: minimal OpenAI-compatible fake model (no body cap; logs sizes).
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const logFile = process.env.FAKE_LOG ?? '/Users/wenshao/pr13335-rig/fake-requests.jsonl';
const port = Number(process.env.FAKE_PORT ?? 18400);
let idx = 0;
const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end('not found');
    return;
  }
  const chunks = [];
  let bytes = 0;
  req.on('data', (c) => { bytes += c.length; chunks.push(c); });
  req.on('end', () => {
    const i = idx++;
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
    chunks.length = 0;
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const users = messages.filter((m) => m && m.role === 'user');
    const lastUser = JSON.stringify(users[users.length - 1] ?? '');
    const marker = /PR13335_[A-Z0-9_]+/.exec(lastUser)?.[0] ?? null;
    const hold = /HOLD(\d+)S/.exec(lastUser);
    appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), idx: i, bodyBytes: bytes,
      lastUserChars: lastUser.length, marker, hold: hold ? Number(hold[1]) : null,
      stream: body.stream === true, tools: Array.isArray(body.tools) ? body.tools.length : 0 }) + '\n');
    const text = `ACK-${marker ?? 'nomarker'}`;
    const model = body.model ?? 'fake-model';
    const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `cmpl-${i}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const send = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ id: `cmpl-${i}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
    const finish = () => { send({}, 'stop', { usage }); res.write('data: [DONE]\n\n'); res.end(); };
    if (hold) {
      send({ role: 'assistant', content: 'HOLDING ' });
      const seconds = Number(hold[1]);
      let n = 0;
      const timer = setInterval(() => {
        if (res.destroyed) { clearInterval(timer); return; }
        n += 1;
        if (n >= seconds) { clearInterval(timer); send({ content: text }); finish(); return; }
        send({ content: '.' });
      }, 1000);
      return;
    }
    send({ role: 'assistant', content: text });
    finish();
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`fake model listening http://127.0.0.1:${port}/v1`);
  writeFileSync('/Users/wenshao/pr13335-rig/fake-model.pid', String(process.pid));
});

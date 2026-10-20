// Minimal OpenAI-compatible streaming server. Records every request body
// verbatim (raw bytes) to $OUT_DIR/req-<n>.json. Script via $SCRIPT (JSON):
// array of steps; step i answers request i: {text} or {tool:{name,args}}.
import http from 'node:http';
import fs from 'node:fs';
const OUT_DIR = process.env.OUT_DIR;
const SCRIPT = JSON.parse(process.env.SCRIPT || '[]');
fs.mkdirSync(OUT_DIR, { recursive: true });
let n = 0;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (!req.url.includes('chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'dummy', object: 'model' }] }));
      return;
    }
    const idx = n++;
    fs.writeFileSync(`${OUT_DIR}/req-${idx}.json`, raw);
    let body = {};
    try { body = JSON.parse(raw.toString('utf8')); } catch {}
    // Background/side queries (non-stream) get a bland JSON answer.
    const isMain = body.stream === true && JSON.stringify(body.messages || []).includes('Current auto-memory catalog');
    const mainIdx = isMain ? (server.mainCount = (server.mainCount || 0) + 1) - 1 : -1;
    const step = isMain ? (SCRIPT[mainIdx] || { text: 'ok' }) : { text: '{}' };
    fs.appendFileSync(`${OUT_DIR}/log.txt`, `req-${idx} stream=${body.stream} main=${isMain} mainIdx=${mainIdx} step=${JSON.stringify(step).slice(0, 80)}\n`);
    const id = 'chatcmpl-' + idx;
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: 'dummy',
        choices: [{ index: 0, message: { role: 'assistant', content: step.text ?? 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const base = { id, object: 'chat.completion.chunk', created: 0, model: 'dummy' };
    if (step.tool) {
      send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + idx, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: step.text ?? 'ok' }, finish_reason: null }] });
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    send({ ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(0, '127.0.0.1', () => {
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${server.address().port}/v1`);
});

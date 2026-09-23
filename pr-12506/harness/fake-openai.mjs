import http from 'node:http'; import { appendFileSync } from 'node:fs';
const [port, log] = [Number(process.argv[2]), process.argv[3]];
http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
  appendFileSync(log, JSON.stringify({ url: req.url, body: b }) + '\n');
  let j = {}; try { j = JSON.parse(b); } catch {}
  const msg = { role: 'assistant', content: 'ok' };
  if (j.stream) { res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: msg, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: msg, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })); }
}); }).listen(port, '127.0.0.1');

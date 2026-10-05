// Minimal OpenAI-compatible server: records every request body as JSONL, replies "OK".
// usage: node fake-openai.mjs <port> <log.jsonl>
import http from 'node:http';
import fs from 'node:fs';
const [port, log] = process.argv.slice(2);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
    }
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    fs.appendFileSync(log, JSON.stringify({ url: req.url, body: parsed }) + '\n');
    const id = 'chatcmpl-x';
    if (parsed.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: 'assistant', content: 'OK' }));
      res.write(chunk({}, 'stop'));
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
    }
  });
});
server.listen(Number(port), '127.0.0.1', () => console.log(`FAKE_READY http://127.0.0.1:${server.address().port}/v1`));

// Minimal OpenAI-compatible chat-completions stub: answers every request with
// a short streamed (or non-streamed) text reply so the Web Shell can create a
// real session. usage: node fake-openai.cjs <port>
const http = require('node:http');

const port = Number(process.argv[2] ?? 4898);
const TEXT = 'ok';

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.method === 'GET' && req.url.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {}
      const id = `chatcmpl-${Date.now()}`;
      const model = parsed.model ?? 'fake-model';
      const usage = { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 };
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const chunk = (delta, finish) =>
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: 'assistant', content: TEXT }, null));
        res.write(chunk({}, 'stop'));
        res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model, choices: [], usage })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id,
            object: 'chat.completion',
            created: 0,
            model,
            choices: [{ index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'stop' }],
            usage,
          }),
        );
      }
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`fake-openai listening on ${port}`));

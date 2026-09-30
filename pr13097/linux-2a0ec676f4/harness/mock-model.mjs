// Minimal OpenAI-compatible streaming endpoint for the streaming-continuity
// scenario: POST /v1/chat/completions drips SSE chunks slowly so the browser
// has a genuinely in-flight assistant turn while we fire read-only commands.
import http from 'node:http';

const port = Number(process.env.MOCK_MODEL_PORT ?? 23197);
const CHUNKS = Number(process.env.MOCK_MODEL_CHUNKS ?? 60);
const INTERVAL_MS = Number(process.env.MOCK_MODEL_INTERVAL_MS ?? 500);

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url?.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const model = (() => {
        try {
          return JSON.parse(body).model ?? 'mock-streamer';
        } catch {
          return 'mock-streamer';
        }
      })();
      let i = 0;
      const timer = setInterval(() => {
        i += 1;
        const done = i >= CHUNKS;
        const payload = {
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: done
                ? {}
                : { content: `chunk-${i} ` },
              finish_reason: done ? 'stop' : null,
            },
          ],
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
        if (done) {
          res.write('data: [DONE]\n\n');
          clearInterval(timer);
          res.end();
        }
      }, INTERVAL_MS);
      res.on('close', () => clearInterval(timer));
    });
    return;
  }
  if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'mock-streamer', object: 'model', owned_by: 'rig' }],
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock model listening on http://127.0.0.1:${port}/v1`);
});

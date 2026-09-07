// Minimal OpenAI-compatible chat-completions server used to drive a real
// `qwen serve` daemon deterministically.
//
// Round 1: emit a todo_write tool call with one `in_progress` item.
// Round 2: stall for SLOW_MS (so the turn is observably live), then answer.
import http from 'node:http';

const PORT = Number(process.env.FAKE_MODEL_PORT ?? 8721);
const SLOW_MS = Number(process.env.FAKE_MODEL_SLOW_MS ?? 25000);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const TODOS = {
  todos: [
    { id: 'a', content: 'Read the code', status: 'completed' },
    { id: 'b', content: 'Apply the fix', status: 'in_progress' },
    { id: 'c', content: 'Run the tests', status: 'pending' },
  ],
};

function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  return {
    send(obj) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    },
    done() {
      res.write('data: [DONE]\n\n');
      res.end();
    },
  };
}

const frame = (model, delta, finish = null) => ({
  id: 'chatcmpl-fake',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    if (!req.url?.includes('chat/completions')) {
      res.writeHead(404).end('{}');
      return;
    }
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {}
    const model = parsed.model ?? 'fake-model';
    const msgs = parsed.messages ?? [];
    const sawTodoResult = msgs.some(
      (m) =>
        m.role === 'tool' ||
        (Array.isArray(m.tool_calls) &&
          m.tool_calls.some((t) => t.function?.name === 'todo_write')),
    );
    const s = sse(res);
    if (!sawTodoResult) {
      log('round 1 -> todo_write tool call');
      s.send(frame(model, { role: 'assistant', content: '' }));
      s.send(
        frame(model, {
          tool_calls: [
            {
              index: 0,
              id: 'call_todo_1',
              type: 'function',
              function: {
                name: 'todo_write',
                arguments: JSON.stringify(TODOS),
              },
            },
          ],
        }),
      );
      s.send(frame(model, {}, 'tool_calls'));
      s.done();
      return;
    }
    log(`round 2 -> stalling ${SLOW_MS}ms before answering`);
    await new Promise((r) => setTimeout(r, SLOW_MS));
    s.send(frame(model, { role: 'assistant', content: 'Plan recorded.' }));
    s.send(frame(model, {}, 'stop'));
    s.done();
    log('round 2 -> answered');
  });
});
server.listen(PORT, '127.0.0.1', () => log(`fake model on :${PORT}`));

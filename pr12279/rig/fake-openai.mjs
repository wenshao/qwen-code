// Minimal OpenAI-compatible chat server for the PR #12279 rig.
// A `[slow:N]` marker in the latest user message makes the main-loop reply
// stream for N seconds (one chunk every 500 ms); everything else answers at
// once. Every request is appended to a JSONL ledger so exactly-once delivery
// of a message can be checked from the model's side.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 18279);
const ledger = process.argv[3] ?? '/root/pr12279/logs/model-ledger.jsonl';

function partsOf(content) {
  if (typeof content === 'string') return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: '', images: 0 };
  let text = '';
  let images = 0;
  for (const part of content) {
    if (part?.type === 'text') text += part.text ?? '';
    if (part?.type === 'image_url') images += 1;
  }
  return { text, images };
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    let json = {};
    try {
      json = JSON.parse(body || '{}');
    } catch {}
    const messages = Array.isArray(json.messages) ? json.messages : [];
    const users = messages
      .filter((m) => m.role === 'user')
      .map((m) => partsOf(m.content));
    const last = users.at(-1) ?? { text: '', images: 0 };
    const hasTools = Array.isArray(json.tools) && json.tools.length > 0;
    const m = /\[slow:(\d+(?:\.\d+)?)\]/.exec(last.text);
    const seconds = hasTools && m ? Number(m[1]) : 0;
    fs.appendFileSync(
      ledger,
      JSON.stringify({
        t: Date.now(),
        path: req.url,
        stream: json.stream === true,
        hasTools,
        nMessages: messages.length,
        lastUserText: last.text.slice(-300),
        lastUserImages: last.images,
        userTexts: users.map((u) => u.text.slice(-160)),
        userImages: users.map((u) => u.images),
        seconds,
      }) + '\n',
    );
    const reply = hasTools
      ? `ACK<${last.text.replace(/\s+/g, ' ').slice(-80).toUpperCase()}> images=${last.images}`
      : 'Rig title';
    if (json.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: json.model,
          choices: [
            { index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      );
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let closed = false;
    res.on('close', () => (closed = true));
    const chunk = (delta, finish = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: 'c1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: json.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    chunk({ role: 'assistant', content: '' });
    const ticks = Math.round(seconds * 2);
    for (let i = 0; i < ticks && !closed; i++) {
      // Vary the text so no loop detector trips on repeated chunks.
      chunk({ content: `working ${i + 1}/${ticks}. ` });
      await new Promise((r) => setTimeout(r, 500));
    }
    if (closed) return;
    chunk({ content: reply });
    chunk({}, 'stop');
    res.write(
      `data: ${JSON.stringify({
        id: 'c1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: json.model,
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })}\n\n`,
    );
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(port, '127.0.0.1', () =>
  console.log(`fake-openai listening on ${port}, ledger ${ledger}`),
);

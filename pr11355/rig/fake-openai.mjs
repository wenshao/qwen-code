// Minimal OpenAI-compatible chat endpoint for PR #11355 verification.
// Every /v1/chat/completions request is appended to $FAKE_OPENAI_LOG as one
// JSON line (last user text, tool count, message count). A mode file
// ($FAKE_OPENAI_MODE, contents "ok" | "hang") decides whether the request is
// answered or held open forever, so a turn can be frozen mid-flight.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.FAKE_OPENAI_PORT ?? 0);
const logFile = process.env.FAKE_OPENAI_LOG;
const modeFile = process.env.FAKE_OPENAI_MODE;
let requestIndex = 0;

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((part) => (typeof part === 'string' ? part : part.text ?? ''))
        .join('');
    }
    return '';
  }
  return '';
}

function mode() {
  try {
    return fs.readFileSync(modeFile, 'utf8').trim() || 'ok';
  } catch {
    return 'ok';
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'dummy', object: 'model' }] }));
      return;
    }
    if (!req.url.startsWith('/v1/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `no route ${req.url}` } }));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('bad json');
      return;
    }
    const index = ++requestIndex;
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const userText = lastUserText(messages);
    const currentMode = mode();
    if (logFile) {
      fs.appendFileSync(
        logFile,
        JSON.stringify({
          t: new Date().toISOString(),
          ms: Date.now(),
          index,
          mode: currentMode,
          stream: parsed.stream === true,
          tools: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
          messages: messages.length,
          lastUser: userText.slice(-6000),
        }) + '\n',
      );
    }
    if (currentMode === 'hang') {
      // Hold the connection open; the caller's turn stays in flight.
      return;
    }
    const answer = `ACK#${index}: ${userText.replace(/\s+/g, ' ').slice(0, 120)}`;
    const id = `chatcmpl-fake-${index}`;
    const created = Math.floor(Date.now() / 1000);
    if (parsed.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const chunk = (delta, finish) =>
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: parsed.model ?? 'dummy',
          choices: [{ index: 0, delta, finish_reason: finish ?? null }],
        })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }));
      res.write(chunk({ content: answer }));
      res.write(chunk({}, 'stop'));
      res.write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: parsed.model ?? 'dummy',
          choices: [],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        object: 'chat.completion',
        created,
        model: parsed.model ?? 'dummy',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: answer },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  });
});

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`FAKE_OPENAI_LISTENING ${address.port}\n`);
});

// OpenAI-compatible fake provider for PR #13390 verification.
// Every main-turn reply is plain text, and the final usage chunk reports
// `prompt_tokens` read from $PROMPT_TOKENS_FILE at request time (fallback
// $PROMPT_TOKENS), so the harness can pick the provider total per turn and
// drive both the scale = 1 and the scale < 1 provider-count paths.
// Every request body is appended to $LOG as one JSON line.
'use strict';
const http = require('node:http');
const fs = require('node:fs');

const LOG = process.env.LOG;
const PORT = Number(process.env.PORT || 0);

function promptTokens() {
  const f = process.env.PROMPT_TOKENS_FILE;
  if (f && fs.existsSync(f)) return Number(fs.readFileSync(f, 'utf8').trim());
  return Number(process.env.PROMPT_TOKENS || 40000);
}

function sse(res, chunks) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

let seq = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {}
    const n = seq++;
    const main =
      body.stream === true && Array.isArray(body.tools) && body.tools.length > 0;
    const pt = main ? promptTokens() : 10;
    if (LOG) {
      fs.appendFileSync(
        LOG,
        JSON.stringify({
          n,
          kind: main ? 'main' : 'side',
          url: req.url,
          promptTokensReported: pt,
          tools: (body.tools || []).map((t) => t.function?.name),
          toolsJsonChars: JSON.stringify(body.tools || []).length,
          body,
        }) + '\n',
      );
    }
    const id = `chatcmpl-${n}`;
    const created = Math.floor(Date.now() / 1000);
    const model = body.model || 'fake-model';
    const text = main ? 'Acknowledged.' : '{}';
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: pt, completion_tokens: 2, total_tokens: pt + 2 },
        }),
      );
      return;
    }
    sse(res, [
      {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: text } }],
      },
      {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
      {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [],
        usage: { prompt_tokens: pt, completion_tokens: 2, total_tokens: pt + 2 },
      },
    ]);
  });
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `FAKE_SERVER_READY http://127.0.0.1:${server.address().port}/v1\n`,
  );
});

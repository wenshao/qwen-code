/**
 * Controllable fake OpenAI-compatible server for PR #11251 verification.
 *
 * Behaviour is switched at runtime through POST /__ctl so one daemon can be
 * driven through completed / cancelled / failed turns without a restart.
 *
 * Modes:
 *   complete  stream a short answer, finish_reason stop
 *   hang      stream a role chunk and then nothing (turn can be cancelled)
 *   error     answer the completion request with HTTP 500 (-> turn_error)
 *   empty     stream no content at all, finish_reason stop
 *   slow      stream the answer one chunk per 1200ms
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';

const PORT = Number(process.env.FAKE_PORT ?? 4991);
const LOG = process.env.FAKE_LOG ?? '/var/tmp/pr11251/fake-openai.log';

let mode = 'complete';
let answer = 'Real answer text from the fake model.';
let requestCount = 0;
const inflight = new Set();

writeFileSync(LOG, '');
const log = (...parts) => {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  appendFileSync(LOG, `${line}\n`);
  console.log(line);
};

function sseChunk(res, delta, finish) {
  const payload = {
    id: 'chatcmpl-probe',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'probe-model',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finish ?? null,
      },
    ],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/__ctl') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const next = JSON.parse(body || '{}');
        if (next.mode) mode = next.mode;
        if (typeof next.answer === 'string') answer = next.answer;
        log(`[ctl] mode=${mode} answer=${JSON.stringify(answer)}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ mode, answer }));
      } catch (error) {
        res.writeHead(400);
        res.end(String(error));
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/__stat') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mode, requestCount, inflight: inflight.size }));
    return;
  }
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'probe-model', object: 'model' }],
      }),
    );
    return;
  }
  if (!req.url?.endsWith('/chat/completions')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  let raw = '';
  req.on('data', (c) => (raw += c));
  await new Promise((r) => req.on('end', r));
  let body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    /* ignore */
  }
  const index = requestCount++;
  const hasImage = JSON.stringify(body.messages ?? []).includes('image_url');
  log(
    `[req#${index}] mode=${mode} model=${body.model} stream=${body.stream} messages=${(body.messages ?? []).length} image=${hasImage}`,
  );

  if (mode === 'error' || mode === 'error400') {
    res.writeHead(mode === 'error400' ? 400 : 500, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'fake upstream failure (probe)',
          type: 'server_error',
          code: 'probe_upstream_error',
        },
      }),
    );
    log(`[req#${index}] -> 500`);
    return;
  }

  if (body.stream !== true) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-probe',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'probe-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: mode === 'empty' ? '' : answer },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    log(`[req#${index}] -> non-stream done`);
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  inflight.add(res);
  res.on('close', () => {
    inflight.delete(res);
    log(`[req#${index}] client closed (aborted=${!res.writableEnded})`);
  });

  sseChunk(res, { role: 'assistant', content: '' });

  if (mode === 'errfinish') {
    sseChunk(res, { content: 'fake mid-stream provider failure (probe)' }, 'error_finish');
    res.write('data: [DONE]\n\n');
    res.end();
    log(`[req#${index}] -> error_finish`);
    return;
  }
  if (mode === 'hang') {
    log(`[req#${index}] -> hanging`);
    return; // never finishes; the turn must be cancelled
  }
  if (mode === 'empty') {
    sseChunk(res, {}, 'stop');
    res.write('data: [DONE]\n\n');
    res.end();
    log(`[req#${index}] -> empty stop`);
    return;
  }

  const chunks = mode === 'slow' ? answer.split(' ').map((w) => `${w} `) : [answer];
  for (const chunk of chunks) {
    if (res.writableEnded || res.destroyed) return;
    sseChunk(res, { content: chunk });
    if (mode === 'slow') await sleep(1200);
  }
  if (res.writableEnded || res.destroyed) return;
  sseChunk(res, {}, 'stop');
  res.write('data: [DONE]\n\n');
  res.end();
  log(`[req#${index}] -> completed`);
});

server.listen(PORT, '127.0.0.1', () => {
  log(`fake openai listening on http://127.0.0.1:${PORT}`);
});

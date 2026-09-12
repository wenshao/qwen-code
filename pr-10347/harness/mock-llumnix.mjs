#!/usr/bin/env node
// Mock of an llumnix-style Go gateway in front of an OpenAI-compatible engine.
//
// Reproduces pkg/gateway/service/gateway_service.go convertErrorResponse():
//   * a NetworkError (peer closed mid-request -> Go `Post "...": EOF`) falls to
//     the default branch -> HTTP 400 with the RAW Go error string as the body
//     (`network error for request to <url>: <err>`), which is not JSON.
//   * streaming requests get that body wrapped as a single SSE `data:` frame
//     plus `data: [DONE]`, with status 400 (writeStreamResponse).
//   * a genuine backend 400 (ErrorBackendBadRequest) is a JSON error envelope.
//
// Usage: node mock-llumnix.mjs --port N --mode MODE --fail K --log FILE
//   MODE: net-sse | net-json | backend-400 | socket-eof | ok
//   --fail K : first K requests fail with MODE, request K+1 succeeds.
//              -1 = always fail.
import http from 'node:http';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i === -1 ? def : argv[i + 1];
};
const port = Number(arg('--port', '8799'));
const mode = arg('--mode', 'net-sse');
const failCount = Number(arg('--fail', '2'));
const logFile = arg('--log', '/tmp/mock-llumnix.jsonl');
const upstream = arg('--upstream', 'http://11.0.0.1:8080/v1/chat/completions');

let seq = 0;
const log = (o) =>
  fs.appendFileSync(logFile, JSON.stringify({ t: Date.now(), ...o }) + '\n');

// Exactly what Go's net/http produces for a peer that closed the connection,
// wrapped by llumnix consts.NetworkError.Error().
const netErrText = `network error for request to ${upstream}: Post "${upstream}": EOF`;

function succeed(res, stream, text) {
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      }),
    );
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const frame = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
  frame({
    id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: 'mock-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
  });
  frame({
    id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: 'mock-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

function failNow(res, stream, n) {
  if (mode === 'mid-stream-eof') {
    // llumnix writeStreamResponse(): when the header is already sent it can
    // only close the connection. The upstream EOF then reaches the client as a
    // premature close mid-SSE, never as a 400.
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.write('data: ' + JSON.stringify({
      id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: 'mock-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'partial' }, finish_reason: null }],
    }) + '\n\n');
    setTimeout(() => res.socket.destroy(), 50);
    return;
  }
  if (mode === 'socket-eof') {
    // The failure llumnix itself sees: peer closes the TCP connection with no
    // HTTP response at all. Reaches the client as ECONNRESET / fetch failed.
    res.socket.destroy();
    return;
  }
  if (mode === 'backend-400') {
    const body = JSON.stringify({
      error: { code: 400, message: 'invalid request: messages[0].content is required' },
    });
    if (stream) {
      res.writeHead(400, { 'content-type': 'text/event-stream; charset=utf-8' });
      res.end(`data: ${body}\n\ndata: [DONE]\n\n`);
    } else {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(body);
    }
    return;
  }
  if (mode === 'net-json') {
    // Hypothetical gateway that wraps the same text in a JSON error envelope.
    const body = JSON.stringify({ error: { code: 400, message: netErrText } });
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }
  // net-sse (llumnix default branch)
  if (stream) {
    res.writeHead(400, { 'content-type': 'text/event-stream; charset=utf-8' });
    res.end(`data: ${netErrText}\n\ndata: [DONE]\n\n`);
  } else {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(netErrText);
  }
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
      return;
    }
    if (!req.url.includes('/chat/completions') && !req.url.includes('/responses')) {
      res.writeHead(404).end('{}');
      return;
    }
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* ignore */ }
    const stream = parsed.stream === true;
    seq += 1;
    const n = seq;
    const willFail = failCount === -1 ? true : n <= failCount;
    log({
      seq: n, stream, willFail, mode,
      lastUserText: JSON.stringify(parsed.messages?.slice(-1)?.[0]?.content ?? '').slice(0, 200),
    });
    process.stdout.write(`[mock] #${n} stream=${stream} -> ${willFail ? 'FAIL(' + mode + ')' : 'OK'}\n`);
    if (willFail) failNow(res, stream, n);
    else succeed(res, stream, 'MOCK_OK_ANSWER_' + n);
  });
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`[mock] listening on 127.0.0.1:${port} mode=${mode} fail=${failCount}\n`);
});

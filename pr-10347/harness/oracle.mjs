#!/usr/bin/env node
// Drives the REAL openai@5.11.0 client (the version this repo pins) against a
// server that returns each candidate 400 body shape, then classifies the real
// SDK error with the BUILT core of both arms.
import http from 'node:http';
import OpenAI from '/root/git/wt10347/node_modules/openai/index.mjs';
const { classifyRetryError: clsPR } = await import('/root/git/wt10347/packages/core/dist/src/utils/retryErrorClassification.js');
const { classifyRetryError: clsBASE } = await import('/root/git/b10347/packages/core/dist/src/utils/retryErrorClassification.js');

const UP = 'http://11.0.0.1:8080/v1/chat/completions';
const TEXT = `network error for request to ${UP}: Post "${UP}": EOF`;

const SHAPES = [
  ['llumnix non-stream: 400 + raw Go text (content-type json)', 400, { 'content-type': 'application/json' }, TEXT],
  ['llumnix stream:     400 + SSE data: <raw text>',            400, { 'content-type': 'text/event-stream; charset=utf-8' }, `data: ${TEXT}\n\ndata: [DONE]\n\n`],
  ['gateway that JSON-wraps the same text',                     400, { 'content-type': 'application/json' }, JSON.stringify({ error: { message: TEXT } })],
  ['JSON-wrapped + type/code',                                  400, { 'content-type': 'application/json' }, JSON.stringify({ error: { message: TEXT, type: 'gateway_error', code: 'do_request_failed' } })],
  ['genuine client 400 from the engine',                        400, { 'content-type': 'application/json' }, JSON.stringify({ error: { message: 'invalid request: messages[0].content is required', code: 400 } })],
];

const rows = [];
for (const [label, status, headers, body] of SHAPES) {
  const server = http.createServer((req, res) => { res.writeHead(status, headers); res.end(body); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const client = new OpenAI({ apiKey: 'k', baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });
  let err;
  try {
    await client.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true });
  } catch (e) { err = e; }
  server.close();
  const b = clsBASE(err), p = clsPR(err);
  rows.push({
    label,
    sdkMessage: String(err?.message ?? '').replace(/\s+/g, ' ').slice(0, 70),
    providerCode: p.providerCode ?? '-', providerMessage: p.providerMessage ? 'set' : 'undefined',
    base: `${b.kind}/${b.diagnosis}/${b.reason}`,
    pr: `${p.kind}/${p.diagnosis}/${p.reason}`,
  });
}
console.log(JSON.stringify(rows, null, 1));

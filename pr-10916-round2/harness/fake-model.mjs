// Scripted OpenAI-compatible fake model for PR #10916 verification.
// usage: node fake-model.mjs <scenario.mjs> <requests.jsonl>
// Prints "FAKE_SERVER_READY <baseUrl>" once listening.
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [scenarioPath, logPath] = process.argv.slice(2);
const scenario = await import(pathToFileURL(path.resolve(scenarioPath)).href);
writeFileSync(logPath, '');

let reqIndex = 0;
const flatten = (c) =>
  typeof c === 'string'
    ? c
    : Array.isArray(c)
      ? c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
      : '';

function classify(body) {
  const msgs = body.messages ?? [];
  const sys = flatten(msgs.find((m) => m.role === 'system')?.content ?? '');
  const last = msgs[msgs.length - 1];
  const lastText = flatten(last?.content ?? '');
  if (!Array.isArray(body.tools) || body.tools.length === 0) return 'side';
  if (lastText.includes('[SUGGESTION MODE')) return 'side';
  if (scenario.classify) {
    const k = scenario.classify({ body, sys, lastText });
    if (k) return k;
  }
  return 'main';
}

function sse(res, chunks) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

function reply(res, body, r) {
  const id = 'chatcmpl-' + reqIndex;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? 'fake';
  const toolCalls = (r.toolCalls ?? []).map((tc, i) => ({
    index: i,
    id: tc.id,
    type: 'function',
    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
  }));
  const finish = toolCalls.length ? 'tool_calls' : 'stop';
  const usage = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };
  if (body.stream) {
    const chunks = [];
    if (r.content)
      chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', content: r.content }, finish_reason: null }] });
    if (toolCalls.length)
      chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: toolCalls }, finish_reason: null }] });
    chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    chunks.push({ id, object: 'chat.completion.chunk', created, model, choices: [], usage });
    sse(res, chunks);
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id, object: 'chat.completion', created, model, usage,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: r.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls.map(({ index, ...t }) => t) } : {}) } }] }));
  }
}

const server = createServer((req, res) => {
  let data = '';
  req.on('data', (d) => (data += d));
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(data || '{}'); } catch {}
    const idx = reqIndex++;
    const kind = req.url.includes('chat/completions') ? classify(body) : 'other';
    const msgs = body.messages ?? [];
    // main step = number of assistant tool-call rounds already in the conversation
    const step = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length).length;
    let r;
    try {
      r = kind === 'side' || kind === 'other'
        ? (scenario.side?.({ body, idx }) ?? { content: '{}' })
        : await scenario.respond({ body, step, idx, kind, msgs });
    } catch (e) {
      r = { content: 'scenario error: ' + e.message };
    }
    appendFileSync(logPath, JSON.stringify({ idx, t: Date.now(), url: req.url, kind, step, nMsgs: msgs.length, stream: !!body.stream, tools: (body.tools ?? []).map((t) => t?.function?.name), messages: msgs, reply: r }) + '\n');
    if (req.url.endsWith('/models')) { res.writeHead(200, {'content-type':'application/json'}); res.end('{"data":[]}'); return; }
    reply(res, body, r);
  });
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`FAKE_SERVER_READY http://127.0.0.1:${port}/v1`);
});

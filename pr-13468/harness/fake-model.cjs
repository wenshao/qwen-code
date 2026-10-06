// Deterministic OpenAI-compatible provider for PR #13468 verification.
// - Logs every request (one JSON line) to $LOG with the last user text, the
//   markers present anywhere in the user/assistant history, and the model.
// - A main-turn whose last user text contains "HOLD" streams one chunk and is
//   held open until GET /control/release (keeps the parent session busy).
// - "codeword" questions are answered from the request's own history, so the
//   reply proves which context the child actually received.
'use strict';
const http = require('node:http');
const fs = require('node:fs');

const LOG = process.env.LOG;
const PORT = Number(process.env.PORT || 0);
const MARKERS = ['ORCHID-7', 'PARENT-AFTER-MARKER', 'CHILD-ONLY-MARKER', 'HOLD-PARENT', 'PRIMARY-CONTEXT'];
const held = [];
let seq = 0;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}
function stripReminders(s) {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

function chunk(id, model, delta, finish) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, ...(finish ? { finish_reason: finish } : {}) }],
  };
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/control/release')) {
    const n = held.length;
    while (held.length) held.shift()();
    res.end(JSON.stringify({ released: n }));
    return;
  }
  if (req.url.startsWith('/control/held')) {
    res.end(JSON.stringify({ held: held.length }));
    return;
  }
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}
    const n = seq++;
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const convo = msgs.filter((m) => m.role === 'user' || m.role === 'assistant');
    const history = convo.map((m) => stripReminders(textOf(m.content))).join('\n');
    const lastUser = stripReminders(
      textOf([...msgs].reverse().find((m) => m.role === 'user')?.content ?? ''),
    );
    const main = body.stream === true && Array.isArray(body.tools) && body.tools.length > 0;
    const markers = MARKERS.filter((m) => history.includes(m));
    const model = body.model || 'fake-model';
    const hold = main && lastUser.includes('HOLD-PARENT') && !/codeword/i.test(lastUser);
    let text;
    if (!main) text = '{"title":"Side task check"}';
    else if (/codeword/i.test(lastUser) && /what is/i.test(lastUser))
      text = history.includes('ORCHID-7')
        ? 'From the inherited parent context: the codeword is ORCHID-7.'
        : 'I do not see any codeword in my context.';
    else if (lastUser.includes('ORCHID-7')) text = 'Noted. I will remember the codeword ORCHID-7.';
    else if (hold) text = ' …finished the long parent task.';
    else text = `Acknowledged: ${lastUser.slice(0, 80)}`;
    if (LOG)
      fs.appendFileSync(
        LOG,
        JSON.stringify({ n, t: Date.now(), kind: main ? 'main' : 'side', model, lastUser: lastUser.slice(0, 200), markers, hold, reply: text, nMessages: msgs.length, lastUserRaw: JSON.stringify([...msgs].reverse().find((m) => m.role === 'user')?.content ?? null).slice(0, 600), roles: msgs.map((m) => m.role).join(',') }) + '\n',
      );
    const id = `chatcmpl-${n}`;
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const finish = () => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(chunk(id, model, { content: text }))}\n\n`);
      res.write(`data: ${JSON.stringify(chunk(id, model, {}, 'stop'))}\n\n`);
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      if (LOG) fs.appendFileSync(LOG, JSON.stringify({ n, t: Date.now(), done: true }) + '\n');
    };
    if (hold) {
      res.write(`data: ${JSON.stringify(chunk(id, model, { role: 'assistant', content: 'Working on the long parent task' }))}\n\n`);
      held.push(finish);
    } else {
      res.write(`data: ${JSON.stringify(chunk(id, model, { role: 'assistant', content: '' }))}\n\n`);
      finish();
    }
  });
});
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`FAKE_SERVER_READY http://127.0.0.1:${server.address().port}/v1\n`);
});

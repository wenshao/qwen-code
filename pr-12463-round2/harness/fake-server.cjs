// Scripted fake OpenAI-compatible endpoint for PR #12463 verification.
// Main model: every line "RUN: <cmd>" in the latest user message becomes one
// run_shell_command tool call, issued one at a time; when all have run, reply
// with a short text. AUTO-mode classifier: always {"shouldBlock": false}
// (or proxied to a real model when REAL_CLASSIFIER_URL is set).
const http = require('node:http');
const fs = require('node:fs');
const LOG = process.env.FAKE_LOG || '/dev/null';
const REAL_URL = process.env.REAL_CLASSIFIER_URL || '';
const REAL_KEY = process.env.REAL_CLASSIFIER_KEY || '';
const REAL_MODEL = process.env.REAL_CLASSIFIER_MODEL || '';
let n = 0;
function textOf(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n');
  return '';
}
function log(o) { fs.appendFileSync(LOG, JSON.stringify(o) + '\n'); }
function sendText(res, body, content) {
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = { id: 'c' + n, object: 'chat.completion.chunk', created: 1, model: body.model };
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'c' + n, object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
}
function sendTool(res, body, command) {
  const args = JSON.stringify({ command, is_background: false, description: 'scripted step' });
  const call = { index: 0, id: 'call_' + n, type: 'function', function: { name: 'run_shell_command', arguments: args } };
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = { id: 'c' + n, object: 'chat.completion.chunk', created: 1, model: body.model };
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n');
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    const { index, ...c } = call;
    res.end(JSON.stringify({ id: 'c' + n, object: 'chat.completion', created: 1, model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [c] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
}
async function proxyClassifier(res, body) {
  const fwd = { ...body, model: REAL_MODEL, enable_thinking: false };
  const r = await fetch(REAL_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + REAL_KEY }, body: JSON.stringify(fwd) });
  const buf = Buffer.from(await r.arrayBuffer());
  log({ n, kind: 'classifier-real', status: r.status, reply: buf.toString('utf8').slice(0, 4000) });
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
  res.end(buf);
}
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', async () => {
    n++;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const msgs = body.messages || [];
    const all = msgs.map((m) => textOf(m.content)).join('\n');
    if (all.includes('security classifier for an AI coding agent')) {
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      log({ n, kind: 'classifier', stream: !!body.stream, tail: textOf(lastUser && lastUser.content).slice(-1500) });
      if (REAL_URL) return proxyClassifier(res, body).catch((e) => { log({ n, err: String(e) }); res.writeHead(500); res.end(); });
      return sendText(res, body, '{"shouldBlock": false}');
    }
    // index of the last genuine user message carrying RUN: lines, or a
    // natural-language line scripted via FAKE_SCRIPT=[{say, steps}]
    const SCRIPT = JSON.parse(process.env.FAKE_SCRIPT || '[]');
    let ui = -1;
    let scripted = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'user') continue;
      const t = textOf(msgs[i].content);
      const hit = SCRIPT.find((e) => t.includes(e.say));
      if (hit) { ui = i; scripted = hit.steps; break; }
      if (/(^|\n)RUN: /.test(t)) { ui = i; break; }
    }
    const hasShell = (body.tools || []).some((t) => t.function && t.function.name === 'run_shell_command');
    if (ui < 0 || !hasShell) {
      log({ n, kind: 'side', stream: !!body.stream, sys: textOf(msgs[0] && msgs[0].content).slice(0, 120) });
      return sendText(res, body, 'ok');
    }
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg.role === 'user' && /^\s*\[SUGGESTION MODE/.test(textOf(lastMsg.content))) {
      log({ n, kind: 'suggestion' });
      return sendText(res, body, '');
    }
    const steps = scripted || [...textOf(msgs[ui].content).matchAll(/RUN: ([^\n]*)/g)].map((m) => m[1]);
    if (process.env.FAKE_DUMP) fs.writeFileSync(LOG + '.user-' + n + '.txt', textOf(msgs[ui].content));
    const done = msgs.slice(ui + 1).filter((m) => m.role === 'tool').length;
    if (done < steps.length) {
      log({ n, kind: 'main-tool', step: done, command: steps[done] });
      return sendTool(res, body, steps[done]);
    }
    log({ n, kind: 'main-final' });
    return sendText(res, body, 'Scripted steps finished.');
  });
});
server.listen(Number(process.env.FAKE_PORT || 0), '127.0.0.1', () => {
  console.log('FAKE_SERVER_READY http://127.0.0.1:' + server.address().port + '/v1');
});

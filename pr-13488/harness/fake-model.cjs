// Scripted OpenAI-compatible model. Behaviour is keyed off the last user text.
const http = require('node:http');
const fs = require('node:fs');
const port = Number(process.argv[2] || 0);
const logFile = process.argv[3] || '/dev/null';
const requests = [];
const strip = (t) => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
const textOf = (m) => strip(typeof m.content === 'string' ? m.content : (m.content || []).map((p) => p.text || '').join('\n'));
function lastUserText(body) {
  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { const t = textOf(msgs[i]); if (t) return t; }
  return '';
}
const userTexts = (body) => (body.messages || []).filter((m) => m.role === 'user').map(textOf).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/control/requests')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(requests)); return; }
  if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] })); return; }
  let raw = ''; for await (const c of req) raw += c;
  let body = {}; try { body = JSON.parse(raw); } catch {}
  const text = lastUserText(body);
  const hasToolResult = (body.messages || []).some((m) => m.role === 'tool');
  const images = (body.messages || []).reduce((n, m) => n + (Array.isArray(m.content) ? m.content.filter((p) => p.type === 'image_url').length : 0), 0);
  const entry = { at: Date.now(), stream: !!body.stream, text: text.slice(0, 200), users: userTexts(body).map((t) => t.slice(0, 80)), images, aborted: false };
  requests.push(entry); fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  let closed = false;
  res.on('close', () => { closed = true; entry.aborted = !res.writableEnded; });
  const id = 'chatcmpl-' + requests.length;
  if (!body.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Fake title' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (delta, finish) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [{ index: 0, delta, finish_reason: finish ?? null }] }) + '\n\n');
  const done = () => { res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'fake-model', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n'); res.write('data: [DONE]\n\n'); res.end(); };
  const m = text.match(/\b(HOLD|THINK|SLOWTEXT|TOOL)\b/);
  const mode = m ? m[1] : 'QUICK';
  if (mode === 'HOLD') { while (!closed) await sleep(50); return; }
  if (mode === 'THINK') { send({ role: 'assistant', reasoning_content: 'Let me think about this ' }); while (!closed) { await sleep(150); if (!closed) send({ reasoning_content: 'more thinking ' }); } return; }
  if (mode === 'SLOWTEXT') { send({ role: 'assistant', content: 'Partial answer: ' }); while (!closed) { await sleep(150); if (!closed) send({ content: 'word ' }); } return; }
  if (mode === 'TOOL' && !hasToolResult) { send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + requests.length, type: 'function', function: { name: 'glob', arguments: JSON.stringify({ pattern: '*.md' }) } }] }); send({}, 'tool_calls'); done(); return; }
  if (mode === 'TOOL') { send({ role: 'assistant', content: 'Tool finished. ' }); while (!closed) { await sleep(150); if (!closed) send({ content: 'still talking ' }); } return; }
  send({ role: 'assistant', content: 'ok: ' + text.slice(0, 60) }); send({}, 'stop'); done();
});
server.listen(port, '127.0.0.1', () => console.log('FAKE_SERVER_READY http://127.0.0.1:' + server.address().port));

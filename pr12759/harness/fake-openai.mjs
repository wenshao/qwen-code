// Scripted OpenAI-compatible model. The user message "CALL <tool> ARGS <json> TIMES <n>" makes the
// model call <tool> with <json> n times in a row, one call per turn; then it answers "done".
// Requests that do not declare the tool (auxiliary calls) get "ok".
import http from 'node:http';
import fs from 'node:fs';
const LOG = process.env.FAKE_LOG;
const text = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(m?.content ?? ''));
http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const b = JSON.parse(body);
  const toolNames = (b.tools ?? []).map((t) => t.function?.name);
  const user = b.messages.filter((m) => m.role === 'user').map(text).find((t) => /CALL \S+ ARGS/.test(t));
  const m = user && /CALL (\S+) ARGS (\{[^}]*\}) TIMES (\d+)/.exec(user);
  const name = m && toolNames.find((n) => n === m[1] || n?.endsWith(`__${m[1]}`));
  let reply = { content: 'ok' };
  if (name) {
    const results = b.messages.filter((x) => x.role === 'tool');
    const last = b.messages.at(-1);
    if (last.role === 'tool') fs.appendFileSync(LOG, JSON.stringify({ event: 'toolResultSeenByModel', n: results.length, content: text(last).slice(0, 400) }) + '\n');
    if (results.length < Number(m[3])) {
      reply = { tool: { name, args: m[2] } };
      fs.appendFileSync(LOG, JSON.stringify({ event: 'emitToolCall', n: results.length + 1, name, args: m[2] }) + '\n');
    } else reply = { content: 'done' };
  }
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
  const chunk = (delta, finish = null) => ({ id, object: 'chat.completion.chunk', created: 0, model: b.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  const frames = reply.tool
    ? [chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + id.slice(-8), type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] }), chunk({}, 'tool_calls')]
    : [chunk({ role: 'assistant', content: reply.content }), chunk({}, 'stop')];
  if (b.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 0, model: b.model, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    const msg = reply.tool ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + id.slice(-8), type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] } : { role: 'assistant', content: reply.content };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, message: msg, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
}).listen(0, '127.0.0.1', function () { fs.writeFileSync(process.env.FAKE_PORT_FILE, String(this.address().port)); });

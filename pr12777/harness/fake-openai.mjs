// Scripted OpenAI-compatible model. The user message "SEQ <json>" holds a list of [tool, argsJson];
// the model makes call number k+1 once it has seen k tool results, one call per turn, then says "done".
// Requests that do not declare the tools (auxiliary calls) get "ok".
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
  const user = b.messages.filter((m) => m.role === 'user').map(text).find((t) => t.includes('SEQ ['));
  const seq = user ? JSON.parse(user.slice(user.indexOf('SEQ [') + 4).trim()) : null;
  let reply = { content: 'ok' };
  if (seq && toolNames.some((n) => n?.startsWith('mcp__probe__'))) {
    const results = b.messages.filter((x) => x.role === 'tool');
    const last = b.messages.at(-1);
    if (last.role === 'tool') fs.appendFileSync(LOG, JSON.stringify({ event: 'resultSeenByModel', n: results.length, tool: seq[results.length - 1][0], content: text(last).slice(0, 300) }) + '\n');
    if (results.length < seq.length) {
      const [tool, args] = seq[results.length];
      const name = toolNames.find((n) => n === `mcp__probe__${tool}`);
      if (!name) throw new Error(`tool ${tool} not declared: ${toolNames.join(',')}`);
      reply = { tool: { name, args } };
      fs.appendFileSync(LOG, JSON.stringify({ event: 'emitToolCall', n: results.length + 1, name, args }) + '\n');
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

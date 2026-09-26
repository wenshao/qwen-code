// Scripted OpenAI-compatible model. A user message "CALL <tool> ARGS <json>" becomes one tool call;
// a tool result gets a final "done" text. Requests without our tools (aux calls) get "ok".
import http from 'node:http';
import fs from 'node:fs';
const LOG = process.env.FAKE_LOG;
const text = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const b = JSON.parse(body);
  const toolNames = (b.tools ?? []).map((t) => t.function?.name);
  const last = b.messages.at(-1);
  let reply;
  const m = /CALL (\S+) ARGS (\{[^}]*\})/.exec(text(last));
  if (last.role === 'tool') {
    reply = { content: 'done' };
    fs.appendFileSync(LOG, JSON.stringify({ event: 'toolResultSeenByModel', content: text(last).slice(0, 300) }) + '\n');
  } else if (last.role === 'user' && m) {
    const name = toolNames.find((n) => n === m[1] || n?.endsWith(`__${m[1]}`));
    fs.appendFileSync(LOG, JSON.stringify({ event: 'emitToolCall', name, args: m[2], declared: toolNames.filter((n) => /lookup/.test(n ?? '')) }) + '\n');
    reply = name ? { tool: { name, args: m[2] } } : { content: `tool ${m[1]} not declared` };
  } else {
    reply = { content: 'ok' };
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
    const msg = reply.tool
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + id.slice(-8), type: 'function', function: { name: reply.tool.name, arguments: reply.tool.args } }] }
      : { role: 'assistant', content: reply.content };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: b.model, choices: [{ index: 0, message: msg, finish_reason: reply.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  }
});
server.listen(0, '127.0.0.1', () => { fs.writeFileSync(process.env.FAKE_PORT_FILE, String(server.address().port)); });

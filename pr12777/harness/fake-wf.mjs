// Scripted model for the workflow probe. Main session (declares `workflow`): call it once with the
// script in $WF_SCRIPT, then say "done". Sub-agent (declares `structured_output`): submit {"answer":0}
// (invalid, minimum is 1); if that came back as a tool result, submit {"answer":7}.
import http from 'node:http';
import fs from 'node:fs';
const LOG = process.env.FAKE_LOG;
const SCRIPT = fs.readFileSync(process.env.WF_SCRIPT, 'utf8');
const text = (m) => (typeof m?.content === 'string' ? m.content : Array.isArray(m?.content) ? m.content.map((p) => p?.text ?? JSON.stringify(p)).join('') : JSON.stringify(m?.content ?? ''));
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  if (!req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  const b = JSON.parse(body);
  const names = (b.tools ?? []).map((t) => t.function?.name);
  const last = b.messages.at(-1);
  let reply = { content: 'ok' };
  if (names.includes('structured_output')) {
    const prompt = b.messages.filter((m) => m.role === 'user').map(text).find((t) => /call \d/.test(t)) ?? '?';
    const which = /call (\d)/.exec(prompt)?.[1];
    if (last.role === 'tool') {
      log({ event: 'subagentSawToolResult', call: which, content: text(last).slice(0, 200) });
      reply = { tool: { name: 'structured_output', args: '{"answer":7}' } };
    } else reply = { tool: { name: 'structured_output', args: '{"answer":0}' } };
    log({ event: 'subagentSubmits', call: which, args: reply.tool.args });
  } else if (names.includes('workflow')) {
    if (last.role === 'tool') { log({ event: 'workflowResult', content: text(last).slice(0, 1500) }); reply = { content: 'done' }; }
    else reply = { tool: { name: 'workflow', args: JSON.stringify({ script: SCRIPT }) } };
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

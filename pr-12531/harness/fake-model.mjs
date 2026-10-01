// Scripted OpenAI-compatible model. argv: <logFile> ; env TARGET_TOOL = registered tool name to call.
// Main turn without a tool result -> one tool call to TARGET_TOOL; once a tool result is present -> final text.
import http from 'node:http';
import fs from 'node:fs';

const logFile = process.argv[2];
const target = process.env.TARGET_TOOL;
let n = 0;
const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + '\n');

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? '').join('');
  return '';
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body || '{}'); } catch {}
    const idx = n++;
    const msgs = j.messages ?? [];
    const toolNames = (j.tools ?? []).map((t) => t.function?.name).filter(Boolean);
    const sys = textOf(msgs.find((m) => m.role === 'system')?.content ?? '');
    const hasMarker = msgs.some((m) => m.role === 'user' && textOf(m.content).includes('VERIFY-PR12531'));
    const isMain = toolNames.length > 0 && hasMarker;
    const toolMsgs = msgs.filter((m) => m.role === 'tool');
    let reply;
    if (isMain && toolMsgs.length === 0) {
      reply = { kind: 'tool_call', name: target };
    } else if (isMain) {
      reply = { kind: 'text', text: 'FINAL tool result was: ' + textOf(toolMsgs.at(-1).content).slice(0, 300) };
    } else {
      reply = { kind: 'text', text: 'ok' };
    }
    log({
      idx, url: req.url, stream: !!j.stream, isMain, nTools: toolNames.length, sys: sys.slice(0, 80),
      mcpToolsDeclared: toolNames.filter((t) => t.startsWith('mcp__')),
      targetDeclared: toolNames.includes(target),
      toolResults: toolMsgs.map((m) => textOf(m.content)),
      reply,
    });
    const id = 'chatcmpl-' + idx;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      if (reply.kind === 'tool_call') {
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + idx, type: 'function', function: { name: reply.name, arguments: '{}' } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
      } else {
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      const message = reply.kind === 'tool_call'
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + idx, type: 'function', function: { name: reply.name, arguments: '{}' } }] }
        : { role: 'assistant', content: reply.text };
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'dummy', choices: [{ index: 0, message, finish_reason: reply.kind === 'tool_call' ? 'tool_calls' : 'stop' }], usage }));
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  console.log('FAKE_READY http://127.0.0.1:' + server.address().port + '/v1');
});

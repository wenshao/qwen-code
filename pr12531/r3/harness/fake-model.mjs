// Scripted OpenAI-compatible model. argv: <logFile> ; env TARGET_TOOL = registered tool name to call,
// FAKE_MODE = direct | agent.
// direct: main turn without a tool result -> one tool call to TARGET_TOOL; once a tool result is present -> final text.
// agent:  main turn -> `agent` call (subagent_type verifier, inline); subagent turn -> TARGET_TOOL; then final texts.
// Requests are classified by content (markers), never by turn count.
import http from 'node:http';
import fs from 'node:fs';

const logFile = process.argv[2];
const target = process.env.TARGET_TOOL;
const mode = process.env.FAKE_MODE ?? 'direct';
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
    const sys = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n');
    const userText = msgs.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('\n');
    const hasMain = userText.includes('VERIFY-PR12531');
    const hasSub = userText.includes('SUBAGENT-TASK-PR12531') || sys.includes('SUBAGENT-PR12531');
    const role = toolNames.length === 0 ? 'aux' : hasMain ? 'main' : hasSub ? 'sub' : 'aux';
    const toolMsgs = msgs.filter((m) => m.role === 'tool');
    let reply;
    if (role === 'main' && toolMsgs.length === 0) {
      reply = mode === 'agent'
        ? { kind: 'tool_call', name: 'agent', args: { description: 'verify', prompt: 'SUBAGENT-TASK-PR12531: call the tool', subagent_type: 'verifier', run_in_background: false } }
        : { kind: 'tool_call', name: target, args: {} };
    } else if (role === 'main') {
      reply = { kind: 'text', text: 'FINAL tool result was: ' + textOf(toolMsgs.at(-1).content).slice(0, 300) };
    } else if (role === 'sub' && toolMsgs.length === 0) {
      reply = { kind: 'tool_call', name: target, args: {} };
    } else if (role === 'sub') {
      reply = { kind: 'text', text: 'SUB FINAL tool result was: ' + textOf(toolMsgs.at(-1).content).slice(0, 300) };
    } else {
      reply = { kind: 'text', text: 'ok' };
    }
    log({
      idx, url: req.url, stream: !!j.stream, role, nTools: toolNames.length, sys: sys.slice(0, 80),
      mcpToolsDeclared: toolNames.filter((t) => t.startsWith('mcp__')),
      targetDeclared: toolNames.includes(target),
      toolResults: toolMsgs.map((m) => textOf(m.content)),
      reply,
    });
    const id = 'chatcmpl-' + idx;
    const created = Math.floor(Date.now() / 1000);
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    const args = JSON.stringify(reply.args ?? {});
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (o) => res.write('data: ' + JSON.stringify(o) + '\n\n');
      if (reply.kind === 'tool_call') {
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + idx, type: 'function', function: { name: reply.name, arguments: args } }] }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage });
      } else {
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] });
        send({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage });
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      const message = reply.kind === 'tool_call'
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_' + idx, type: 'function', function: { name: reply.name, arguments: args } }] }
        : { role: 'assistant', content: reply.text };
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'dummy', choices: [{ index: 0, message, finish_reason: reply.kind === 'tool_call' ? 'tool_calls' : 'stop' }], usage }));
    }
  });
});
server.listen(0, '127.0.0.1', () => {
  console.log('FAKE_READY http://127.0.0.1:' + server.address().port + '/v1');
});

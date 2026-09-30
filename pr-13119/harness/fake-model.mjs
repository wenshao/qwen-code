// Scripted OpenAI-compatible model: first turn issues one run_shell_command
// tool call whose command is taken from the prompt (RUN<<...>>); once a tool
// result is present it answers with plain text.
import http from 'node:http';
const port = Number(process.argv[2] || 0);
let n = 0;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}
    const msgs = body.messages || [];
    const text = (m) => typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join('') : '';
    const hasTool = msgs.some((m) => m.role === 'tool');
    const users = msgs.filter((m) => m.role === 'user').map(text).join('\n');
    const cmd = (users.match(/RUN<<([\s\S]*?)>>/) || [])[1];
    const id = `chatcmpl-${++n}`;
    const created = Math.floor(Date.now() / 1000);
    const toolCall = !hasTool && cmd && body.tools?.length;
    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: 'dummy',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'close' });
    const send = (delta, finish = null, usage) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'dummy', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`);
    send({ role: 'assistant' });
    if (toolCall) {
      send({ tool_calls: [{ index: 0, id: `call_${n}`, type: 'function', function: { name: 'run_shell_command', arguments: '' } }] });
      send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ command: cmd, description: 'probe', is_background: false }) } }] });
      send({}, 'tool_calls', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
    } else {
      send({ content: 'done' });
      send({}, 'stop', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`FAKE_MODEL_READY http://127.0.0.1:${server.address().port}/v1`);
});

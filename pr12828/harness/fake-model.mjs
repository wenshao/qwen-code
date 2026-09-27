// OpenAI-compatible fake model for the PR #12828 rig. It answers every chat
// completion with a short streamed echo, so a turn completes and the ACP child
// writes its records. A prompt containing TOUCH-<name> gets one
// run_shell_command tool call `touch <name>.marker` (for deny-rule checks).
import http from 'node:http';
export function startFakeModel(label = 'fake') {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch {}
      const msgs = json.messages ?? [];
      const last = msgs.at(-1);
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
      const text = typeof lastUser?.content === 'string' ? lastUser.content
        : (lastUser?.content ?? []).map((p) => p.text ?? '').join('');
      requests.push({ t: Date.now(), url: req.url, stream: !!json.stream, tools: (json.tools ?? []).length, lastUser: text.slice(-120), lastRole: last?.role });
      if (!req.url.includes('chat/completions')) { res.writeHead(404); res.end(); return; }
      const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
      const base = { id: 'c1', object: 'chat.completion.chunk', created: 1, model: json.model };
      const toolNames = (json.tools ?? []).map((t) => t.function?.name);
      const touch = /TOUCH-(\w+)/.exec(text);
      if (!json.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'c1', object: 'chat.completion', created: 1, model: json.model, choices: [{ index: 0, message: { role: 'assistant', content: `[${label}] ok` }, finish_reason: 'stop' }], usage }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, finish = null) => res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }], ...(finish ? { usage } : {}) })}\n\n`);
      if (touch && last?.role === 'user' && toolNames.includes('run_shell_command')) {
        chunk({ role: 'assistant', content: `[${label}] touching ${touch[1]}` });
        chunk({ tool_calls: [{ index: 0, id: `call_${requests.length}`, type: 'function', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: `touch ${touch[1]}.marker`, description: 'rig touch' }) } }] });
        chunk({}, 'tool_calls');
        res.end('data: [DONE]\n\n');
        return;
      }
      const reply = last?.role === 'tool'
        ? `[${label}] tool said: ${String(typeof last.content === 'string' ? last.content : JSON.stringify(last.content)).slice(0, 80)}`
        : `[${label}] ack: ${text.slice(-60).replace(/\s+/g, ' ')}`;
      chunk({ role: 'assistant', content: reply });
      chunk({}, 'stop');
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, requests, close: () => new Promise((r) => server.close(r)) });
  }));
}

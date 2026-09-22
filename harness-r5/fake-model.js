// Scripted OpenAI-compatible server: logs every request body; replies with plain text,
// or a single run_shell_command tool call when FAKE_TOOL_CMD is set (then text after a tool result).
const http = require('node:http');
const fs = require('node:fs');
const port = Number(process.argv[2] || 18431);
const logFile = process.argv[3] || '/root/verify/h12267r5/out/requests.jsonl';
const cmdFile = '/root/verify/h12267r5/fake-tool-cmd.txt';
function sse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.write('data: [DONE]\n\n'); res.end();
}
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(body); } catch {}
    fs.appendFileSync(logFile, JSON.stringify({ url: req.url, body: j }) + '\n');
    const base = { id: 'x', object: 'chat.completion.chunk', created: 1, model: 'dummy' };
    const hasTool = (j.messages || []).some((m) => m.role === 'tool');
    const cmd = fs.existsSync(cmdFile) ? fs.readFileSync(cmdFile, 'utf8').trim() : '';
    if (cmd && !hasTool) {
      return sse(res, [
        { ...base, choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: cmd, description: 'probe' }) } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ]);
    }
    sse(res, [
      { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'done' }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    ]);
  });
}).listen(port, '127.0.0.1', () => console.log('listening', port));

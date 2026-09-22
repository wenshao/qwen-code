// Scripted OpenAI-compatible model. Answers "ANSWER <token>" for the T-… token
// found in the LAST user turn, and logs every request (token + whether the
// group-history block is present + the flattened last user turn).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const LOGS = process.env.DT_LOGS || path.join(path.dirname(new URL(import.meta.url).pathname), 'logs');
fs.mkdirSync(LOGS, { recursive: true });
const log = path.join(LOGS, 'openai.jsonl');
const PORT = Number(process.env.OPENAI_PORT || 28090);
const flat = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '');
const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
const chunk = (delta, finish) => ({ id: 'chatcmpl-h', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'harness-model', choices: [{ index: 0, delta, finish_reason: finish ?? null }] });

http.createServer(async (req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); await new Promise((r) => req.on('end', r));
  if (!req.url.includes('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'harness-model', object: 'model' }] })); }
  const parsed = JSON.parse(body || '{}');
  const msgs = parsed.messages ?? [];
  const users = msgs.filter((m) => m.role === 'user');
  const lastUser = flat(users[users.length - 1]?.content);
  const tokens = [...lastUser.matchAll(/T-[A-Za-z0-9-]+/g)].map((m) => m[0]);
  const token = tokens[tokens.length - 1] ?? 'none';
  const toolRound = msgs.slice(msgs.map((m) => m.role).lastIndexOf('user') + 1).some((m) => m.role === 'tool');
  const wantTool = /TOOL-TOUCH/.test(lastUser) && !toolRound;
  fs.appendFileSync(log, JSON.stringify({ t: Date.now(), token, tokens, wantTool, hasHistory: lastUser.includes('[Chat messages since your last reply'), lastUser: lastUser.slice(-1500) }) + '\n');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  sse(res, chunk({ role: 'assistant', content: '' }));
  if (wantTool) {
    sse(res, chunk({ tool_calls: [{ index: 0, id: `call_touch_${token}`, type: 'function', function: { name: 'run_shell_command', arguments: JSON.stringify({ command: `touch ${token}.txt`, description: 'create marker file' }) } }] }));
    sse(res, chunk({}, 'tool_calls'));
  } else {
    sse(res, chunk({ content: `ANSWER ${token}` }));
    sse(res, chunk({}, 'stop'));
  }
  res.write('data: [DONE]\n\n'); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`[fake-openai] http://127.0.0.1:${PORT}/v1`));

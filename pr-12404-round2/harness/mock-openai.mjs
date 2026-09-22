// Mock OpenAI-compatible provider. Logs every chat/completions request body
// (full messages) to $MOCK_LOG as JSONL so model input can be diffed across arms.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const PORT = Number(process.env.MOCK_PORT || 18414);
const LOG = process.env.MOCK_LOG || '/root/verify/pr12404-r2-e2e/out/mock-requests.jsonl';
const sse = (res, o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = req.url || '';
  if (url.includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
  }
  if (!url.includes('/chat/completions')) { res.writeHead(404); return res.end('{}'); }
  let parsed = {}; try { parsed = JSON.parse(body); } catch {}
  const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const txt = (c) => Array.isArray(c) ? c.map((p) => typeof p === 'string' ? p : p?.text ?? `[${p?.type}]`).join(' ') : String(c ?? '');
  const isSide = !parsed.stream || /title|summar/i.test(JSON.stringify(parsed.messages?.[0]?.content ?? '').slice(0, 400)) && msgs.length <= 2;
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), stream: !!parsed.stream, tools: (parsed.tools || []).length, lastUser: txt(lastUser?.content), messages: msgs }) + '\n');
  const shown = txt(lastUser?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const reply = `Done. (mock reply)`;
  if (!parsed.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: 'mock-model', choices: [{ index: 0, message: { role: 'assistant', content: 'Tag replay check' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
  }
  if (/SLOWTURN/.test(txt(lastUser?.content))) await new Promise((r) => setTimeout(r, 40000));
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const base = { id: 'c' + Date.now(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };
  sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  sse(res, { ...base, choices: [{ index: 0, delta: { content: reply }, finish_reason: null }] });
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } });
  res.write('data: [DONE]\n\n'); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock on ${PORT}`));

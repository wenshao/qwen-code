// Mock OpenAI-compatible provider. Streams a slow, multi-chunk reply so a real
// turn stays non-idle for a controllable duration, then settles.
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 18644);
const CHUNKS = Number(process.env.MOCK_CHUNKS || 6);
const CHUNK_MS = Number(process.env.MOCK_CHUNK_MS || 120);

const log = (...a) => console.log(new Date().toISOString(), ...a);

function sse(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const url = req.url || '';
  if (url.includes('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }));
    return;
  }
  if (!url.includes('/chat/completions')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  let parsed = {};
  try { parsed = JSON.parse(body); } catch {}
  const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
  const asText = (c) => Array.isArray(c)
    ? c.map((p) => (typeof p === 'string' ? p : p?.text ?? (p?.type === 'image_url' ? '[image]' : ''))).join(' ')
    : String(c ?? '');
  let promptRaw = asText(lastUser?.content);
  // Strip the system-reminder blocks the CLI appends so the echo shows the
  // user's own words — that is what makes the transcript assertions readable.
  promptRaw = promptRaw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ' ');
  const prompt = promptRaw.replace(/\s+/g, ' ').trim().slice(0, 120);
  const countImgs = (c) => Array.isArray(c) ? c.filter((x) => x && (x.type === 'image_url' || x.type === 'image')).length : 0;
  const imagesAll = msgs.reduce((n, m) => n + countImgs(m.content), 0);
  const rawAll = JSON.stringify(msgs);
  log('chat/completions images_last=' + countImgs(lastUser?.content) + ' images_all=' + imagesAll + ' marker=' + ((rawAll.match(/MRK-[a-z]+-\d+/) || [''])[0]) + ' prompt=', JSON.stringify(prompt));
  const reply = `ACK<${prompt.replace(/\s+/g, ' ').trim()}>`;

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model' };
  sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
  const parts = [];
  for (let i = 0; i < CHUNKS; i++) parts.push(i === 0 ? reply : ` .${i}`);
  for (const p of parts) {
    await new Promise((r) => setTimeout(r, CHUNK_MS));
    sse(res, { ...base, choices: [{ index: 0, delta: { content: p }, finish_reason: null }] });
  }
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(PORT, '127.0.0.1', () => log(`mock provider on http://127.0.0.1:${PORT}`));

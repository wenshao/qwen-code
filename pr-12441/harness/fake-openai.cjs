// Tiny OpenAI-compatible chat server (streaming + non-streaming). Records every request.
const http = require('http'); const fs = require('fs'); const path = require('path');
const PORT = Number(process.env.PORT || 18480);
const LOG = process.env.LOG || path.join(__dirname, 'fake-openai.log');
let n = 0;
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const idx = ++n; let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const last = Array.isArray(j.messages) ? j.messages[j.messages.length - 1] : undefined;
    const lastText = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');
    fs.appendFileSync(LOG, `${new Date().toISOString()} #${idx} ${req.method} ${req.url} stream=${!!j.stream} last=${lastText.slice(0, 160).replace(/\n/g, ' ')}\n`);
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] })); }
    const text = `Typed reply #${idx} from the fake model.`;
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const base = { id: 'c' + idx, object: 'chat.completion.chunk', created: 0, model: 'fake-model' };
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'c' + idx, object: 'chat.completion', created: 0, model: 'fake-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } }));
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`FAKE_OPENAI_READY ${PORT}`));

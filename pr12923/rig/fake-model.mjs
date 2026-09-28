// Standalone fake OpenAI-compatible vision model for PR #12923 verification.
// Records every image part it receives (sha256 of the decoded bytes) in a JSONL
// ledger, then answers with what it saw, so "the model received one image with
// the uploaded bytes" is checked against the provider request itself.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const port = Number(process.argv[2] || 0);
const ledger = process.argv[3];

function imagesIn(messages) {
  const out = [];
  messages.forEach((m, mi) => {
    if (!Array.isArray(m.content)) return;
    for (const part of m.content) {
      const url = part?.image_url?.url ?? part?.image_url;
      if (part?.type === 'image_url' && typeof url === 'string') {
        const mm = url.match(/^data:([^;]+);base64,(.*)$/s);
        if (mm) {
          const buf = Buffer.from(mm[2], 'base64');
          out.push({
            message: mi,
            role: m.role,
            mime: mm[1],
            bytes: buf.length,
            sha256: crypto.createHash('sha256').update(buf).digest('hex'),
          });
        } else out.push({ message: mi, role: m.role, url: url.slice(0, 80) });
      }
    }
  });
  return out;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('\n');
  return '';
}

let n = 0;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    if (!req.url.includes('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'fake-model', object: 'model' }] }));
      return;
    }
    let j = {};
    try {
      j = JSON.parse(body);
    } catch {}
    const msgs = j.messages || [];
    const tools = (j.tools || []).map((t) => t.function?.name);
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    const images = imagesIn(msgs);
    const lastUserImages = imagesIn(lastUser ? [lastUser] : []);
    const id = ++n;
    const main = tools.length >= 10;
    const reply = main
      ? {
          content:
            lastUserImages.length > 0
              ? `Received ${lastUserImages.length} image(s): ` +
                lastUserImages.map((i) => `${i.mime} ${i.bytes} bytes sha256 ${i.sha256.slice(0, 12)}`).join('; ')
              : `ACK #${id} (no image in the latest user message)`,
        }
      : { content: 'side-query-ok' };
    if (ledger) {
      fs.appendFileSync(
        ledger,
        JSON.stringify({
          id,
          at: new Date().toISOString(),
          tools: tools.length,
          main,
          lastUserText: textOf(lastUser?.content).slice(0, 200),
          images,
          lastUserImages,
          reply: reply.content,
        }) + '\n',
      );
    }
    const delayMs = main && /SLOW-TURN/.test(textOf(lastUser?.content)) ? 9000 : 0;
    setTimeout(() => respond(), delayMs);
    function respond() {
    const created = Math.floor(Date.now() / 1000);
    const cid = `chatcmpl-${id}`;
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta, finish = null, u) =>
        res.write(
          `data: ${JSON.stringify({ id: cid, object: 'chat.completion.chunk', created, model: j.model, choices: [{ index: 0, delta, finish_reason: finish }], ...(u ? { usage: u } : {}) })}\n\n`,
        );
      send({ role: 'assistant' });
      send({ content: reply.content });
      send({}, 'stop', usage);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: cid,
          object: 'chat.completion',
          created,
          model: j.model,
          choices: [{ index: 0, message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }],
          usage,
        }),
      );
    }
    }
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`fake-model listening on ${server.address().port}`);
});

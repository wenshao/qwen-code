// VERIFICATION RIG ONLY (PR #13206): deterministic OpenAI-compatible model that streams numbered chunks.
// The script is chosen by a marker in the LAST user message:
//   UI_STREAM n=<k> delay=<ms> tag=<T> [para=1]   streams k chunks "[T-001] " ... with <ms> between them (para=1: one paragraph per chunk)
//   anything else                        "PLAIN_OK"
// Every chunk is a separate SSE chunk so the Harness emits one delta per chunk.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15206);
const log = process.argv[3] ?? 'model-requests.jsonl';
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const chunk = (d, f) =>
  JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => {
        if (m.role === 'user') lastUser = i;
      });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const marker = [...userText.matchAll(/UI_STREAM([^\n"\\]*)/g)].at(-1);
      const opts = Object.fromEntries([...(marker?.[1] ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
      fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), kind: marker ? 'STREAM' : 'PLAIN', opts, stream: body.stream }) + '\n');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (!marker) {
        res.end(`data: ${chunk({ role: 'assistant', content: 'PLAIN_OK' }, null)}\n\n` + `data: ${chunk({}, 'stop')}\n\n` + 'data: [DONE]\n\n');
        return;
      }
      const n = Number(opts.n ?? 10);
      const delay = Number(opts.delay ?? 50);
      const tag = opts.tag ?? 'T';
      res.write(`data: ${chunk({ role: 'assistant', content: '' }, null)}\n\n`);
      for (let i = 1; i <= n; i++) {
        if (delay) await sleep(delay);
        const body = opts.para ? `[${tag}-${String(i).padStart(3, '0')}] paragraph ${i} of the ${tag} answer, padded so the transcript scrolls.\n\n` : `[${tag}-${String(i).padStart(3, '0')}] `;
        res.write(`data: ${chunk({ content: body }, null)}\n\n`);
      }
      res.end(`data: ${chunk({}, 'stop')}\n\n` + 'data: [DONE]\n\n');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));

// VERIFICATION RIG ONLY (PR #13179): deterministic OpenAI-compatible model. Script chosen by a marker in the LAST user message:
//   UI_STREAM n=<k> delay=<ms> tag=<T> [para=1]   streams k text chunks "[T-001] " ... (one Harness delta per chunk)
//   UI_STEPS s=<base64url JSON [[tool,args,{sleepMs}?],...]>  one tool call per round, in order (optionally waiting sleepMs first); then "UI_DONE results=[...]"
//   anything else                                  "PLAIN_OK"
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 15179);
const log = process.argv[3] ?? 'model-requests.jsonl';
const text = (c) => (typeof c === 'string' ? c : JSON.stringify(c ?? ''));
const chunk = (d, f) => JSON.stringify({ id: 'rig', object: 'chat.completion.chunk', created: 0, model: 'rig-model', choices: [{ index: 0, delta: d, finish_reason: f }] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function reply(res, delta, finish) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.end(`data: ${chunk({ role: 'assistant', ...delta }, null)}\n\n` + `data: ${chunk({}, finish)}\n\n` + 'data: [DONE]\n\n');
}
http
  .createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
      const messages = body.messages ?? [];
      let lastUser = -1;
      messages.forEach((m, i) => { if (m.role === 'user') lastUser = i; });
      const userText = lastUser >= 0 ? text(messages[lastUser].content) : '';
      const after = messages.slice(lastUser + 1);
      const results = after.filter((m) => m.role === 'tool').map((r) => text(r.content).replace(/\s+/g, ' ').slice(0, 300));
      const rounds = after.filter((m) => m.role === 'assistant').length;
      const marker = [...userText.matchAll(/UI_(STREAM|STEPS)([^\n"\\]*)/g)].at(-1);
      const kind = marker?.[1] ?? 'PLAIN';
      const opts = Object.fromEntries([...(marker?.[2] ?? '').matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
      fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), kind, rounds, opts: kind === 'STEPS' ? undefined : opts, results }) + '\n');
      if (kind === 'STEPS') {
        const steps = JSON.parse(Buffer.from(opts.s, 'base64url').toString('utf8'));
        if (rounds < steps.length) {
          const [name, args, extra] = steps[rounds];
          if (extra?.sleepMs) await sleep(extra.sleepMs);
          reply(res, { content: `step ${rounds}: ${name}`, tool_calls: [{ index: 0, id: `rig-call-${rounds}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
        } else reply(res, { content: `UI_DONE results=${JSON.stringify(results)}` }, 'stop');
        return;
      }
      if (kind === 'PLAIN') { reply(res, { content: 'PLAIN_OK' }, 'stop'); return; }
      const n = Number(opts.n ?? 10), delay = Number(opts.delay ?? 50), tag = opts.tag ?? 'T';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${chunk({ role: 'assistant', content: '' }, null)}\n\n`);
      for (let i = 1; i <= n; i++) {
        if (delay) await sleep(delay);
        const body = opts.para ? `[${tag}-${String(i).padStart(4, '0')}] paragraph ${i} of the ${tag} answer.\n\n` : `[${tag}-${String(i).padStart(4, '0')}] `;
        res.write(`data: ${chunk({ content: body }, null)}\n\n`);
      }
      res.end(`data: ${chunk({}, 'stop')}\n\n` + 'data: [DONE]\n\n');
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`model listening ${port}`));
